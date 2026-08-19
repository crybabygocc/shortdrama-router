import { execFile } from "node:child_process"
import { constants } from "node:fs"
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { inflateRawSync } from "node:zlib"
import { defaultRuntimeRoot, detectRuntimePlatform, managedRuntimePath } from "./platform.js"
import type {
  ProviderRuntimeDefinition,
  ProviderRuntimeInstallOptions,
  ProviderRuntimeStatus,
  ProviderRuntimeStatusOptions,
  RuntimePlatform,
} from "./types.js"

const execFileAsync = promisify(execFile)
const metadataName = "runtime.json"
const defaultMaximumBytes = 256 * 1024 * 1024

interface RuntimeMetadata {
  readonly installed_at: string
  readonly platform: RuntimePlatform
  readonly release_version: string
  readonly source_url: string
  readonly version?: string
}

function unsupportedStatus(definition: ProviderRuntimeDefinition, platform: string): ProviderRuntimeStatus {
  return {
    compatible: false,
    id: definition.id,
    managed: true,
    platform,
    reason: `${definition.display_name} does not provide a runtime for ${platform}`,
    reason_code: "runtime_platform_unsupported",
    state: "unsupported_platform",
  }
}

function resolvedPlatform(definition: ProviderRuntimeDefinition, requested?: RuntimePlatform) {
  const platform = requested ?? detectRuntimePlatform()
  if (!platform || !definition.platforms.includes(platform)) return undefined
  return platform
}

async function download(url: string, options: {
  readonly fetch: typeof fetch
  readonly maximumBytes: number
  readonly signal?: AbortSignal
}) {
  const response = await options.fetch(url, {
    redirect: "follow",
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) throw new Error(`runtime download failed with HTTP ${response.status}`)
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > options.maximumBytes) {
    throw new Error("runtime download is larger than the configured limit")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("runtime download returned an empty body")
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > options.maximumBytes) {
      await reader.cancel()
      throw new Error("runtime download is larger than the configured limit")
    }
    chunks.push(next.value)
  }
  const output = Buffer.allocUnsafe(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function endOfCentralDirectory(bytes: Buffer) {
  const minimum = Math.max(0, bytes.length - 65_557)
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error("runtime archive is not a supported ZIP file")
}

function executableFromZip(bytes: Buffer, executable: string) {
  const end = endOfCentralDirectory(bytes)
  const entries = bytes.readUInt16LE(end + 10)
  let offset = bytes.readUInt32LE(end + 16)
  for (let index = 0; index < entries; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("runtime ZIP directory is invalid")
    const method = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const uncompressedSize = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8")
    const basename = name.split("/").filter(Boolean).at(-1)
    if (basename === executable) {
      if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("runtime ZIP entry is invalid")
      const localNameLength = bytes.readUInt16LE(localOffset + 26)
      const localExtraLength = bytes.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const compressed = bytes.subarray(start, start + compressedSize)
      const output = method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? inflateRawSync(compressed)
          : undefined
      if (!output || output.byteLength !== uncompressedSize) {
        throw new Error("runtime ZIP entry uses an unsupported compression format")
      }
      return output
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`runtime ZIP does not contain ${executable}`)
}

async function probeExecutable(
  definition: ProviderRuntimeDefinition,
  executablePath: string,
  releaseVersion?: string,
  signal?: AbortSignal,
) {
  const result = await execFileAsync(executablePath, [...definition.version_command], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    signal,
    timeout: 30_000,
  })
  return definition.probe(`${result.stdout}\n${result.stderr}`.trim(), releaseVersion)
}

async function readMetadata(providerDirectory: string): Promise<RuntimeMetadata | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(providerDirectory, metadataName), "utf8")) as Partial<RuntimeMetadata>
    if (
      typeof value.installed_at !== "string"
      || typeof value.platform !== "string"
      || typeof value.release_version !== "string"
      || typeof value.source_url !== "string"
    ) return undefined
    return value as RuntimeMetadata
  } catch {
    return undefined
  }
}

export async function getManagedRuntimeStatus(
  definition: ProviderRuntimeDefinition,
  options: ProviderRuntimeStatusOptions = {},
): Promise<ProviderRuntimeStatus> {
  const detected = options.platform ?? detectRuntimePlatform()
  const platform = resolvedPlatform(definition, options.platform)
  if (!platform) return unsupportedStatus(definition, detected ?? `${process.platform}-${process.arch}`)
  const rootDir = path.resolve(options.rootDir ?? defaultRuntimeRoot())
  const providerDirectory = path.join(rootDir, definition.id)
  const executablePath = managedRuntimePath(definition, rootDir)
  try {
    await access(executablePath, process.platform === "win32" ? constants.F_OK : constants.X_OK)
  } catch {
    return {
      compatible: false,
      id: definition.id,
      managed: true,
      platform,
      reason: `${definition.display_name} runtime is not installed`,
      reason_code: "runtime_not_installed",
      state: "not_installed",
    }
  }
  const metadata = await readMetadata(providerDirectory)
  try {
    const probe = await probeExecutable(definition, executablePath, metadata?.release_version, options.signal)
    return {
      compatible: probe.compatible,
      executable_path: executablePath,
      id: definition.id,
      ...(metadata?.installed_at ? { installed_at: metadata.installed_at } : {}),
      managed: true,
      platform,
      ...(probe.reason ? { reason: probe.reason } : {}),
      ...(probe.reason_code ? { reason_code: probe.reason_code } : {}),
      ...(metadata?.release_version ? { release_version: metadata.release_version } : {}),
      ...(metadata?.source_url ? { source_url: metadata.source_url } : {}),
      state: probe.compatible ? "installed" : "invalid",
      ...(probe.version ? { version: probe.version } : metadata?.version ? { version: metadata.version } : {}),
    }
  } catch {
    return {
      compatible: false,
      executable_path: executablePath,
      id: definition.id,
      ...(metadata?.installed_at ? { installed_at: metadata.installed_at } : {}),
      managed: true,
      platform,
      reason: `${definition.display_name} runtime could not be executed`,
      reason_code: "runtime_probe_failed",
      ...(metadata?.release_version ? { release_version: metadata.release_version } : {}),
      ...(metadata?.source_url ? { source_url: metadata.source_url } : {}),
      state: "invalid",
    }
  }
}

export async function installManagedRuntime(
  definition: ProviderRuntimeDefinition,
  options: ProviderRuntimeInstallOptions = {},
): Promise<ProviderRuntimeStatus> {
  const detected = options.platform ?? detectRuntimePlatform()
  const platform = resolvedPlatform(definition, options.platform)
  if (!platform) return unsupportedStatus(definition, detected ?? `${process.platform}-${process.arch}`)
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const release = await definition.resolve_release({
    fetch: fetchImplementation,
    platform,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const bytes = await download(release.artifact.url, {
    fetch: fetchImplementation,
    maximumBytes: release.artifact.maximum_bytes ?? defaultMaximumBytes,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const executable = release.artifact.archive === "binary"
    ? bytes
    : executableFromZip(bytes, release.artifact.executable_name ?? definition.executable)
  const rootDir = path.resolve(options.rootDir ?? defaultRuntimeRoot())
  await mkdir(rootDir, { recursive: true })
  const temporaryDirectory = await mkdtemp(path.join(rootDir, `.${definition.id}-`))
  const temporaryExecutable = path.join(temporaryDirectory, definition.executable)
  const providerDirectory = path.join(rootDir, definition.id)
  const backupDirectory = path.join(rootDir, `.${definition.id}-previous-${process.pid}-${Date.now()}`)
  let movedPrevious = false
  try {
    await writeFile(temporaryExecutable, executable, { mode: 0o755 })
    if (process.platform !== "win32") await chmod(temporaryExecutable, 0o755)
    const probe = await probeExecutable(definition, temporaryExecutable, release.version, options.signal)
    if (!probe.compatible) throw new Error(probe.reason ?? `${definition.display_name} runtime is incompatible`)
    const metadata: RuntimeMetadata = {
      installed_at: (options.now ?? (() => new Date()))().toISOString(),
      platform,
      release_version: release.version,
      source_url: release.artifact.url,
      ...(probe.version ? { version: probe.version } : {}),
    }
    await writeFile(path.join(temporaryDirectory, metadataName), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
    try {
      await rename(providerDirectory, backupDirectory)
      movedPrevious = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    await rename(temporaryDirectory, providerDirectory)
    if (movedPrevious) await rm(backupDirectory, { force: true, recursive: true })
    return await getManagedRuntimeStatus(definition, {
      platform,
      rootDir,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true })
    if (movedPrevious) {
      try {
        await rename(backupDirectory, providerDirectory)
      } catch {
        // Preserve the original error; the backup remains available for manual recovery.
      }
    }
    throw error
  }
}
