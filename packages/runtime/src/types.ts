export type RuntimePlatform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win32-arm64"
  | "win32-x64"

export interface ProviderRuntimeArtifact {
  readonly archive: "binary" | "zip"
  readonly executable_name?: string
  readonly maximum_bytes?: number
  readonly url: string
}

export interface ProviderRuntimeRelease {
  readonly artifact: ProviderRuntimeArtifact
  readonly version: string
}

export interface ProviderRuntimeProbeResult {
  readonly compatible: boolean
  readonly reason?: string
  readonly reason_code?: string
  readonly version?: string
}

export interface ProviderRuntimeDefinition {
  readonly display_name: string
  readonly executable: string
  readonly id: string
  readonly platforms: readonly RuntimePlatform[]
  readonly probe: (
    output: string,
    releaseVersion?: string,
  ) => ProviderRuntimeProbeResult
  readonly resolve_release: (options: {
    readonly fetch: typeof fetch
    readonly platform: RuntimePlatform
    readonly signal?: AbortSignal
  }) => Promise<ProviderRuntimeRelease>
  readonly version_command: readonly string[]
}

export type ProviderRuntimeState =
  | "installed"
  | "invalid"
  | "not_installed"
  | "unsupported_platform"

export interface ProviderRuntimeStatus {
  readonly compatible: boolean
  readonly executable_path?: string
  readonly id: string
  readonly installed_at?: string
  readonly managed: true
  readonly platform: string
  readonly reason?: string
  readonly reason_code?: string
  readonly release_version?: string
  readonly source_url?: string
  readonly state: ProviderRuntimeState
  readonly version?: string
}

export interface ProviderRuntimeInstallOptions {
  readonly fetch?: typeof fetch
  readonly now?: () => Date
  readonly platform?: RuntimePlatform
  readonly rootDir?: string
  readonly signal?: AbortSignal
}

export interface ProviderRuntimeStatusOptions {
  readonly platform?: RuntimePlatform
  readonly rootDir?: string
  readonly signal?: AbortSignal
}

export interface ProviderRuntimeService {
  getStatus(provider: string, options?: { readonly signal?: AbortSignal }): Promise<ProviderRuntimeStatus>
  install(provider: string, options?: { readonly signal?: AbortSignal }): Promise<ProviderRuntimeStatus>
  supports(provider: string): boolean
}
