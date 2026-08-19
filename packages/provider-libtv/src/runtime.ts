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
const artifacts: Readonly<Record<RuntimePlatform, {
  readonly executable_sha256: string
  readonly name: string
  readonly sha256: string
}>> = {
  "darwin-arm64": { executable_sha256: "8605ff53e9f2185f09ba59597ba811e12d90294411ae15710e334be56a4d6e34", name: "libtv-macos-arm64.zip", sha256: "f8a320e9e34b266699410f8ddd00f54004304449cad2ec03367401dac42bba61" },
  "darwin-x64": { executable_sha256: "2a325a5625282d2541729dcfa928ebc5207cfff27d2fd2da6f14e8397edb99b3", name: "libtv-macos-x64.zip", sha256: "74f49ac1794c42d6bcf7747d42bd1998f0c8953766c5ec185fe7d8ca04341763" },
  "linux-arm64": { executable_sha256: "870967ac955b1e1d29bf0563dd28dce04d011503373fca45c607d8f1dc3f03d7", name: "libtv-linux-arm64.zip", sha256: "6eed711cb68c943eef7828be2dd177d3493ae81b64cea90b149e0fd4dead97df" },
  "linux-x64": { executable_sha256: "5f5ea5c775b228ecd64e2fd676fb32f899cda570f965ea078628863d313aa2d0", name: "libtv-linux-x64.zip", sha256: "1596dd93ad9a01c695ec2e15600126bb7e5c1ebda06b2ce880dca778f5da237b" },
  "win32-arm64": { executable_sha256: "84b02fbf0340aa8e9d54e799eb2a18910895274023291010cba9a1d63757fd20", name: "libtv-windows-arm64.zip", sha256: "e6e3d67fba88aa5080ac21b73c5ab4d7c7f417551162fb896fcbd92997fbd220" },
  "win32-x64": { executable_sha256: "f5f28f33fd0e84eaedde8dd2d228b705787f2097b286aee9ca839e5f5ead6301", name: "libtv-windows-amd64.zip", sha256: "5a979946a6d6a7d6e704efb91f8246ca6cf1c9a587f00460fdade4518b4d74ac" },
}

function trustedRelease(platform: RuntimePlatform, version: string) {
  if (version !== supportedVersion) return undefined
  const artifact = artifacts[platform]
  if (!artifact) return undefined
  return {
    artifact: {
      archive: "zip" as const,
      executable_name: platform.startsWith("win32-") ? "libtv.exe" : "libtv",
      executable_sha256: artifact.executable_sha256,
      maximum_bytes: 256 * 1024 * 1024,
      sha256: artifact.sha256,
      url: `${downloadBase}/${supportedVersion}/${artifact.name}`,
    },
    version,
  }
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
    return trustedRelease(options.platform, supportedVersion)!
  },
  resolve_trusted_release(options) {
    return trustedRelease(options.platform, options.version)
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
