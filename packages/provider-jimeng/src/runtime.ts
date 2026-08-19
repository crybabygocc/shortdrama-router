import {
  getManagedRuntimeStatus,
  installManagedRuntime,
  managedRuntimePath,
  RuntimeIntegrityError,
  type ProviderRuntimeDefinition,
  type ProviderRuntimeInstallOptions,
  type ProviderRuntimeStatusOptions,
  type RuntimePlatform,
} from "@shortdrama-router/runtime"

const downloadBase = "https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/dreamina_cli_beta"
const versionUrl = "https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/version.json"
const supportedVersion = "1.4.17"

const artifacts: Readonly<Record<RuntimePlatform, { readonly name: string; readonly sha256: string } | undefined>> = {
  "darwin-arm64": { name: "dreamina_cli_darwin_arm64", sha256: "a9dadf84a3708493cb64e15ec3bcaa714604b62e2e917e8114b7236e5809cdeb" },
  "darwin-x64": { name: "dreamina_cli_darwin_amd64", sha256: "8dd15c549799342ee3e2c5a19d590f7aa42e6940a7327b8e8d174e976280a99f" },
  "linux-arm64": { name: "dreamina_cli_linux_arm64", sha256: "23ffc16a3f3569c7d2985baee843217b73034f0fe649a6dda517b6d95d5beb9c" },
  "linux-x64": { name: "dreamina_cli_linux_amd64", sha256: "78e49e845b70b17c42015f9214a295564c9bf9048f8a5745429c18566c270ff3" },
  "win32-arm64": undefined,
  "win32-x64": { name: "dreamina_cli_windows_amd64.exe", sha256: "7b88b1e770cd4410d1ac6779057adf7e9e0f6a1a00bc4fb2b9a564db8ddb999e" },
}

function trustedRelease(platform: RuntimePlatform, version: string) {
  const artifact = artifacts[platform]
  if (!artifact || version !== supportedVersion) return undefined
  return {
    artifact: {
      archive: "binary" as const,
      executable_sha256: artifact.sha256,
      maximum_bytes: 128 * 1024 * 1024,
      sha256: artifact.sha256,
      url: `${downloadBase}/${artifact.name}`,
    },
    version,
  }
}

function reportedVersion(output: string) {
  const start = output.indexOf("{")
  const end = output.indexOf("}", start + 1)
  if (start !== -1 && end !== -1) {
    try {
      const value = JSON.parse(output.slice(start, end + 1)) as { version?: unknown }
      if (typeof value.version === "string" && value.version.trim()) return value.version.trim()
    } catch {
      // Fall through to the textual version format used by older official builds.
    }
  }
  return output.match(/(?:dreamina(?:_cli)?(?:\s+version)?|version)[:=\s]+([0-9][0-9A-Za-z.+_-]*)/iu)?.[1]
}

export const jimengRuntimeDefinition: ProviderRuntimeDefinition = {
  display_name: "Dreamina CLI",
  executable: process.platform === "win32" ? "dreamina.exe" : "dreamina",
  id: "jimeng",
  platforms: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"],
  probe(output) {
    const version = reportedVersion(output)
    return version
      ? { compatible: true, version }
      : {
          compatible: false,
          reason: "Dreamina CLI did not return a recognizable version",
          reason_code: "runtime_version_unrecognized",
        }
  },
  async resolve_release(options) {
    const artifact = artifacts[options.platform]
    if (!artifact) throw new Error(`Dreamina CLI does not support ${options.platform}`)
    const response = await options.fetch(versionUrl, {
      redirect: "follow",
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!response.ok) throw new Error(`Dreamina version discovery failed with HTTP ${response.status}`)
    const value = await response.json() as { version?: unknown }
    if (typeof value.version !== "string" || !value.version.trim()) {
      throw new Error("Dreamina version discovery returned an invalid response")
    }
    const release = trustedRelease(options.platform, value.version.trim())
    if (!release) {
      throw new RuntimeIntegrityError(`Dreamina CLI ${value.version.trim()} has no trusted artifact digest in this router release`)
    }
    return release
  },
  resolve_trusted_release(options) {
    return trustedRelease(options.platform, options.version)
  },
  version_command: ["--version"],
}

export function jimengManagedCliPath(rootDir?: string) {
  return managedRuntimePath(jimengRuntimeDefinition, rootDir)
}

export function getJimengRuntimeStatus(options?: ProviderRuntimeStatusOptions) {
  return getManagedRuntimeStatus(jimengRuntimeDefinition, options)
}

export function installJimengRuntime(options?: ProviderRuntimeInstallOptions) {
  return installManagedRuntime(jimengRuntimeDefinition, options)
}
