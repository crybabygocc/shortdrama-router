import {
  getManagedRuntimeStatus,
  installManagedRuntime,
  managedRuntimePath,
  type ProviderRuntimeDefinition,
  type ProviderRuntimeInstallOptions,
  type ProviderRuntimeStatusOptions,
  type RuntimePlatform,
} from "@shortdrama-router/runtime"

const supportedVersion = "1.0.2"
const downloadBase = "https://liblibai-web-static.liblib.cloud/cli"
const artifacts: Readonly<Record<RuntimePlatform, string>> = {
  "darwin-arm64": "libtv-macos-arm64.zip",
  "darwin-x64": "libtv-macos-x64.zip",
  "linux-arm64": "libtv-linux-arm64.zip",
  "linux-x64": "libtv-linux-x64.zip",
  "win32-arm64": "libtv-windows-arm64.zip",
  "win32-x64": "libtv-windows-amd64.zip",
}

function reportedVersion(output: string) {
  return output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/u)?.[1]
}

export const libtvRuntimeDefinition: ProviderRuntimeDefinition = {
  display_name: "LibTV CLI",
  executable: process.platform === "win32" ? "libtv.exe" : "libtv",
  id: "libtv",
  platforms: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"],
  probe(output) {
    const version = reportedVersion(output)
    if (!version) {
      return {
        compatible: false,
        reason: "LibTV CLI did not return a recognizable version",
        reason_code: "runtime_version_unrecognized",
      }
    }
    if (version !== supportedVersion) {
      return {
        compatible: false,
        reason: `LibTV CLI ${version} is not supported; install ${supportedVersion}`,
        reason_code: "runtime_version_incompatible",
        version,
      }
    }
    return { compatible: true, version }
  },
  async resolve_release(options) {
    return {
      artifact: {
        archive: "zip",
        executable_name: process.platform === "win32" ? "libtv.exe" : "libtv",
        maximum_bytes: 256 * 1024 * 1024,
        url: `${downloadBase}/${supportedVersion}/${artifacts[options.platform]}`,
      },
      version: supportedVersion,
    }
  },
  version_command: ["--version"],
}

export function libtvManagedCliPath(rootDir?: string) {
  return managedRuntimePath(libtvRuntimeDefinition, rootDir)
}

export function getLibTvRuntimeStatus(options?: ProviderRuntimeStatusOptions) {
  return getManagedRuntimeStatus(libtvRuntimeDefinition, options)
}

export function installLibTvRuntime(options?: ProviderRuntimeInstallOptions) {
  return installManagedRuntime(libtvRuntimeDefinition, options)
}
