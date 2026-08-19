export type AuthorizationMethod = "api_key" | "oauth" | "browser_session"

export type AuthorizationManagement = "managed" | "external"

export type AuthorizationAction = "status" | "begin" | "complete" | "cancel" | "clear"

export type AuthorizationState =
  | "not_configured"
  | "pending"
  | "configured"
  | "valid"
  | "expiring"
  | "expired"
  | "error"

export interface ProviderAuthorizationStatus {
  readonly authorized: boolean | null
  readonly configured: boolean
  readonly expires_at?: string
  readonly method: AuthorizationMethod | null
  /** Stable, machine-readable explanation. */
  readonly reason_code?: string
  /** @deprecated Use reason_code for control flow; reason is display-only. */
  readonly reason?: string
  readonly state: AuthorizationState
  readonly verified_at?: string
}

export interface ProviderAuthorizationMethodDescriptor {
  readonly actions: readonly AuthorizationAction[]
  readonly management: AuthorizationManagement
  readonly method: AuthorizationMethod
}

export interface ProviderAuthorizationOverview {
  readonly effective_method: AuthorizationMethod | null
  readonly methods: readonly ProviderAuthorizationStatus[]
}

export type ProviderConfigurationState =
  | "not_required"
  | "configuration_required"
  | "configuration_configured"
  | "configuration_valid"
  | "configuration_unavailable"
  | "error"

export interface ProviderResource {
  readonly id: string
  readonly name: string
  readonly type: string
}

export interface ProviderConfigurationStatus {
  readonly configured: boolean
  readonly reason?: string
  readonly reason_code?: string
  readonly resource?: ProviderResource
  readonly state: ProviderConfigurationState
  readonly verified_at?: string
}

export interface ProviderConfigurationSelection {
  readonly resource_id: string
  readonly resource_type: string
}

export interface ProviderDependencyDescriptor {
  readonly executable: string
  readonly id: string
  readonly kind: "executable"
  readonly managed_install?: boolean
  readonly required: true
  readonly source_url?: string
  readonly version_command: readonly string[]
}

export interface ProviderDependencyStatus extends ProviderDependencyDescriptor {
  readonly available: boolean | null
  readonly compatible: boolean | null
  readonly reason?: string
  readonly reason_code?: string
  readonly version?: string
}

export interface ProviderCapabilities {
  readonly authorization: readonly AuthorizationMethod[]
  readonly authorization_methods?: readonly ProviderAuthorizationMethodDescriptor[]
  readonly cancellation?: readonly ("audio" | "image" | "video")[]
  readonly configuration?: boolean
  readonly generation: readonly ("audio" | "image" | "video")[]
  readonly ingestion?: readonly ("audio" | "image" | "video")[]
  readonly models: true
  readonly usage: boolean
}

export interface ProviderMetadata {
  readonly capabilities: ProviderCapabilities
  readonly contract_version?: string
  readonly dependencies?: readonly ProviderDependencyDescriptor[]
  readonly description: string
  readonly id: string
  readonly name: string
}

export interface ProviderDescriptor extends ProviderMetadata {
  readonly authorization: ProviderAuthorizationStatus
  readonly authorizations?: ProviderAuthorizationOverview
  readonly configuration?: ProviderConfigurationStatus
  readonly dependency_statuses?: readonly ProviderDependencyStatus[]
}

export type CapabilityConstraint<T extends number | string> =
  | { readonly kind: "enum"; readonly values: readonly T[] }
  | (T extends number ? { readonly kind: "range"; readonly max: number; readonly min: number; readonly step?: number } : never)
  | { readonly kind: "unknown" }
  | { readonly kind: "unsupported" }

export interface ProviderModelConstraints {
  readonly aspect_ratio?: CapabilityConstraint<string>
  readonly duration?: CapabilityConstraint<number>
  readonly resolution?: CapabilityConstraint<string>
  readonly size?: CapabilityConstraint<string>
}

export interface ProviderModelReferenceCapabilities {
  readonly audio?: boolean
  readonly first_frame?: boolean
  readonly image?: boolean
  readonly last_frame?: boolean
  readonly video?: boolean
}

export type ProviderModelAvailabilityState = "available" | "unavailable" | "unknown"

export interface ProviderModelAvailability {
  readonly observed_at?: string
  readonly reason?: string
  readonly reason_code?: string
  readonly state: ProviderModelAvailabilityState
}

export interface ProviderOptionsSchema {
  readonly additional_properties?: boolean
  readonly properties: Readonly<Record<string, {
    readonly description?: string
    readonly enum?: readonly (boolean | number | string)[]
    readonly type: "boolean" | "number" | "object" | "string"
  }>>
}

export interface ProviderModelCapabilities {
  readonly audio_formats?: readonly string[]
  readonly audio_reference?: boolean
  readonly aspect_ratios?: readonly string[]
  readonly audio_input?: boolean
  readonly authorization?: readonly AuthorizationMethod[]
  readonly constraints?: ProviderModelConstraints
  readonly durations?: readonly number[] | null
  readonly first_frame?: boolean
  readonly last_frame?: boolean
  readonly reference_image?: boolean
  readonly resolutions?: readonly string[]
  readonly output_media_types?: readonly string[]
  readonly references?: ProviderModelReferenceCapabilities
  readonly sample_rates?: readonly number[]
  readonly seed?: boolean
  readonly video_input?: boolean
}

export interface ProviderModel {
  readonly availability?: ProviderModelAvailability
  readonly capabilities: ProviderModelCapabilities
  readonly description: string
  readonly id: string
  readonly kind: "audio" | "image" | "video"
  readonly name: string
  readonly provider: string
  readonly provider_options_schema?: ProviderOptionsSchema
}

export interface ProviderAssetReference {
  readonly expires_at?: string
  readonly id?: string
  readonly kind?: "audio" | "image" | "video"
  readonly provider?: string
  /** @deprecated Provider-native compatibility field. Prefer provider + id. */
  readonly asset_id?: string
  /** @deprecated Provider-native compatibility field. Prefer provider + id. */
  readonly pippit_asset_id?: string
}

export interface ProviderAssetIngestionRequest {
  readonly data: Uint8Array
  readonly filename?: string
  readonly idempotency_key?: string
  readonly kind: "audio" | "image" | "video"
  readonly media_type: string
}

export interface VideoInputReference {
  readonly provider_asset: ProviderAssetReference
  readonly type: "image" | "video" | "audio"
}

export interface VideoFrameImages {
  readonly first_frame?: ProviderAssetReference
  readonly last_frame?: ProviderAssetReference
}

export interface VideoCreateRequest {
  readonly aspect_ratio?: string
  readonly duration?: number
  readonly frame_images?: VideoFrameImages
  readonly idempotency_key?: string
  readonly input_references?: readonly VideoInputReference[]
  readonly model: string
  readonly prompt: string
  readonly provider?: string
  readonly provider_options?: Readonly<Record<string, unknown>>
  readonly resolution?: string
  readonly seed?: number
}

export interface ImageCreateRequest {
  readonly aspect_ratio?: string
  readonly idempotency_key?: string
  readonly input_references?: readonly ProviderAssetReference[]
  readonly model: string
  readonly n?: number
  readonly prompt: string
  readonly provider?: string
  readonly provider_options?: Readonly<Record<string, unknown>>
  readonly resolution?: string
  readonly size?: string
}

export interface AudioCreateRequest {
  readonly format?: string
  readonly idempotency_key?: string
  readonly input_references?: readonly AudioInputReference[]
  readonly model: string
  readonly prompt: string
  readonly provider?: string
  readonly provider_options?: Readonly<Record<string, unknown>>
}

export interface AudioInputReference {
  readonly provider_asset: ProviderAssetReference
  readonly type: "audio" | "image"
}

export type GenerationJobStatus =
  | "submitting"
  | "submission_unknown"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"

export type ImageJobStatus = GenerationJobStatus
export type AudioJobStatus = GenerationJobStatus
export type VideoJobStatus = GenerationJobStatus

export interface AudioOutput {
  readonly content_type?: string
  readonly url: string
}

export interface MediaArtifact {
  readonly expires_at?: string
  readonly kind: "audio" | "image" | "video"
  readonly media_type: string
  readonly size_bytes?: number
  readonly temporary?: boolean
  readonly url: string
}

export type GenerationErrorCategory =
  | "invalid_request"
  | "unsupported"
  | "authorization"
  | "configuration"
  | "model_unavailable"
  | "rate_limit"
  | "provider_failure"
  | "timeout"
  | "cancelled"
  | "conflict"
  | "internal"

export interface GenerationJobError {
  readonly category?: GenerationErrorCategory
  readonly code: string
  readonly message: string
  readonly provider?: string
  readonly provider_code?: string
  readonly retryable?: boolean
}

export interface AudioJob {
  readonly artifacts?: readonly MediaArtifact[]
  readonly created_at: string
  readonly error?: GenerationJobError
  readonly id: string
  readonly model: string
  readonly outputs?: readonly AudioOutput[]
  readonly provider: string
  readonly status: AudioJobStatus
  readonly updated_at: string
}

export interface ImageOutput {
  readonly content_type?: string
  readonly url: string
}

export interface ImageJob {
  readonly artifacts?: readonly MediaArtifact[]
  readonly created_at: string
  readonly error?: GenerationJobError
  readonly id: string
  readonly model: string
  readonly outputs?: readonly ImageOutput[]
  readonly provider: string
  readonly status: ImageJobStatus
  readonly updated_at: string
}

export interface VideoOutput {
  readonly content_type?: string
  readonly url: string
}

export interface VideoJob {
  readonly artifacts?: readonly MediaArtifact[]
  readonly created_at: string
  readonly error?: GenerationJobError
  readonly id: string
  readonly model: string
  readonly outputs?: readonly VideoOutput[]
  readonly provider: string
  readonly status: VideoJobStatus
  readonly updated_at: string
}

export interface ProviderVideoJobResult {
  readonly artifacts?: readonly MediaArtifact[]
  readonly error?: { readonly code: string; readonly message: string }
  readonly outputs?: readonly VideoOutput[]
  readonly reference: Readonly<Record<string, unknown>>
  readonly status: VideoJobStatus
}

export interface ProviderImageJobResult {
  readonly artifacts?: readonly MediaArtifact[]
  readonly error?: { readonly code: string; readonly message: string }
  readonly outputs?: readonly ImageOutput[]
  readonly reference: Readonly<Record<string, unknown>>
  readonly status: ImageJobStatus
}

export interface ProviderAudioJobResult {
  readonly artifacts?: readonly MediaArtifact[]
  readonly error?: { readonly code: string; readonly message: string }
  readonly outputs?: readonly AudioOutput[]
  readonly reference: Readonly<Record<string, unknown>>
  readonly status: AudioJobStatus
}

export interface ProviderAuthorizationRequest {
  readonly authorization_id: string
  readonly cookie_names?: readonly string[]
  readonly cookie_origin?: string
  readonly expires_at: string
  readonly login_url: string
  readonly method: AuthorizationMethod
}

export interface ProviderAuthorizationCompletion {
  readonly authorization_id: string
  readonly cookie_origin?: string
  readonly cookies?: readonly {
    readonly expires_at?: string
    readonly name: string
    readonly value: string
  }[]
  readonly method: AuthorizationMethod
}

export interface ProviderAdapter {
  readonly metadata: ProviderMetadata
  beginAuthorization?(
    method: AuthorizationMethod,
    signal?: AbortSignal,
  ): Promise<ProviderAuthorizationRequest>
  cancelAuthorization?(authorizationId: string, signal?: AbortSignal): Promise<void>
  clearAuthorization?(signal?: AbortSignal): Promise<void>
  clearAuthorizationMethod?(method: AuthorizationMethod, signal?: AbortSignal): Promise<void>
  clearConfiguration?(signal?: AbortSignal): Promise<void>
  configure?(selection: ProviderConfigurationSelection, signal?: AbortSignal): Promise<ProviderConfigurationStatus>
  completeAuthorization?(
    completion: ProviderAuthorizationCompletion,
    signal?: AbortSignal,
  ): Promise<ProviderAuthorizationStatus>
  createAudio?(
    request: AudioCreateRequest,
    signal?: AbortSignal,
  ): Promise<ProviderAudioJobResult>
  createImage?(
    request: ImageCreateRequest,
    signal?: AbortSignal,
  ): Promise<ProviderImageJobResult>
  createVideo(
    request: VideoCreateRequest,
    signal?: AbortSignal,
  ): Promise<ProviderVideoJobResult>
  cancelAudio?(reference: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<ProviderAudioJobResult>
  cancelImage?(reference: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<ProviderImageJobResult>
  cancelVideo?(reference: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<ProviderVideoJobResult>
  deleteAsset?(reference: ProviderAssetReference, signal?: AbortSignal): Promise<void>
  getAuthorizationStatuses?(options?: {
    readonly probe?: boolean
    readonly signal?: AbortSignal
  }): Promise<ProviderAuthorizationOverview>
  getAuthorizationStatus(options?: {
    readonly probe?: boolean
    readonly signal?: AbortSignal
  }): Promise<ProviderAuthorizationStatus>
  getConfigurationStatus?(options?: {
    readonly probe?: boolean
    readonly signal?: AbortSignal
  }): Promise<ProviderConfigurationStatus>
  getDependencyStatuses?(options?: {
    readonly probe?: boolean
    readonly signal?: AbortSignal
  }): Promise<readonly ProviderDependencyStatus[]>
  getAudio?(
    reference: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<ProviderAudioJobResult>
  getImage?(
    reference: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<ProviderImageJobResult>
  getVideo(
    reference: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<ProviderVideoJobResult>
  ingestAsset?(request: ProviderAssetIngestionRequest, signal?: AbortSignal): Promise<ProviderAssetReference>
  listResources?(options?: {
    readonly signal?: AbortSignal
    readonly type?: string
  }): Promise<readonly ProviderResource[]>
  listModels(options?: {
    readonly signal?: AbortSignal
  }): Promise<readonly ProviderModel[]>
}

export interface StoredImageJob {
  readonly job: ImageJob
  readonly idempotency_key?: string
  readonly reference?: Readonly<Record<string, unknown>>
  readonly request_hash?: string
  readonly version?: number
}

export interface StoredAudioJob {
  readonly job: AudioJob
  readonly idempotency_key?: string
  readonly reference?: Readonly<Record<string, unknown>>
  readonly request_hash?: string
  readonly version?: number
}

export interface StoredVideoJob {
  readonly job: VideoJob
  readonly idempotency_key?: string
  readonly reference?: Readonly<Record<string, unknown>>
  readonly request_hash?: string
  readonly version?: number
}

export interface JobClaimResult<T> {
  readonly created: boolean
  readonly value: T
}

export interface VideoJobStore {
  claim?(value: StoredVideoJob): Promise<JobClaimResult<StoredVideoJob>>
  compareAndSet?(id: string, expectedVersion: number, value: StoredVideoJob): Promise<boolean>
  get(id: string): Promise<StoredVideoJob | undefined>
  getByIdempotencyKey?(key: string): Promise<StoredVideoJob | undefined>
  put(value: StoredVideoJob): Promise<void>
}

export interface ImageJobStore {
  claim?(value: StoredImageJob): Promise<JobClaimResult<StoredImageJob>>
  compareAndSet?(id: string, expectedVersion: number, value: StoredImageJob): Promise<boolean>
  get(id: string): Promise<StoredImageJob | undefined>
  getByIdempotencyKey?(key: string): Promise<StoredImageJob | undefined>
  put(value: StoredImageJob): Promise<void>
}

export interface AudioJobStore {
  claim?(value: StoredAudioJob): Promise<JobClaimResult<StoredAudioJob>>
  compareAndSet?(id: string, expectedVersion: number, value: StoredAudioJob): Promise<boolean>
  get(id: string): Promise<StoredAudioJob | undefined>
  getByIdempotencyKey?(key: string): Promise<StoredAudioJob | undefined>
  put(value: StoredAudioJob): Promise<void>
}
