import {
  getManagedRuntimeStatus,
  installManagedRuntime,
  managedRuntimePath,
  type ProviderRuntimeDefinition,
  type ProviderRuntimeInstallOptions,
  type ProviderRuntimeStatusOptions,
  type RuntimePlatform,
} from "@shortdrama-router/runtime"

const downloadBase = "https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/dreamina_cli_beta"
const versionUrl = "https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/version.json"

const artifacts: Readonly<Record<RuntimePlatform, string | undefined>> = {
  "darwin-arm64": "dreamina_cli_darwin_arm64",
  "darwin-x64": "dreamina_cli_darwin_amd64",
  "linux-arm64": "dreamina_cli_linux_arm64",
  "linux-x64": "dreamina_cli_linux_amd64",
  "win32-arm64": undefined,
  "win32-x64": "dreamina_cli_windows_amd64.exe",
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
    return {
      artifact: {
        archive: "binary",
        maximum_bytes: 128 * 1024 * 1024,
        url: `${downloadBase}/${artifact}`,
      },
      version: value.version.trim(),
    }
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
