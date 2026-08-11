export type AuthorizationMethod = "api_key" | "oauth" | "browser_session"

export type AuthorizationState =
  | "not_configured"
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
  readonly reason?: string
  readonly state: AuthorizationState
  readonly verified_at?: string
}

export interface ProviderCapabilities {
  readonly authorization: readonly AuthorizationMethod[]
  readonly generation: readonly ("audio" | "image" | "video")[]
  readonly models: true
  readonly usage: boolean
}

export interface ProviderMetadata {
  readonly capabilities: ProviderCapabilities
  readonly description: string
  readonly id: string
  readonly name: string
}

export interface ProviderDescriptor extends ProviderMetadata {
  readonly authorization: ProviderAuthorizationStatus
}

export interface ProviderModelCapabilities {
  readonly audio_formats?: readonly string[]
  readonly audio_reference?: boolean
  readonly aspect_ratios?: readonly string[]
  readonly audio_input?: boolean
  readonly authorization?: readonly AuthorizationMethod[]
  readonly durations?: readonly number[] | null
  readonly first_frame?: boolean
  readonly last_frame?: boolean
  readonly reference_image?: boolean
  readonly resolutions?: readonly string[]
  readonly sample_rates?: readonly number[]
  readonly seed?: boolean
  readonly video_input?: boolean
}

export interface ProviderModel {
  readonly capabilities: ProviderModelCapabilities
  readonly description: string
  readonly id: string
  readonly kind: "audio" | "image" | "video"
  readonly name: string
  readonly provider: string
}

export interface ProviderAssetReference {
  readonly asset_id?: string
  readonly pippit_asset_id: string
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

export interface AudioJob {
  readonly created_at: string
  readonly error?: { readonly code: string; readonly message: string }
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
  readonly created_at: string
  readonly error?: { readonly code: string; readonly message: string }
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
  readonly created_at: string
  readonly error?: { readonly code: string; readonly message: string }
  readonly id: string
  readonly model: string
  readonly outputs?: readonly VideoOutput[]
  readonly provider: string
  readonly status: VideoJobStatus
  readonly updated_at: string
}

export interface ProviderVideoJobResult {
  readonly error?: { readonly code: string; readonly message: string }
  readonly outputs?: readonly VideoOutput[]
  readonly reference: Readonly<Record<string, unknown>>
  readonly status: VideoJobStatus
}

export interface ProviderImageJobResult {
  readonly error?: { readonly code: string; readonly message: string }
  readonly outputs?: readonly ImageOutput[]
  readonly reference: Readonly<Record<string, unknown>>
  readonly status: ImageJobStatus
}

export interface ProviderAudioJobResult {
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
  clearAuthorization?(signal?: AbortSignal): Promise<void>
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
  getAuthorizationStatus(options?: {
    readonly probe?: boolean
    readonly signal?: AbortSignal
  }): Promise<ProviderAuthorizationStatus>
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
  listModels(options?: {
    readonly signal?: AbortSignal
  }): Promise<readonly ProviderModel[]>
}

export interface StoredImageJob {
  readonly job: ImageJob
  readonly reference: Readonly<Record<string, unknown>>
}

export interface StoredAudioJob {
  readonly job: AudioJob
  readonly reference: Readonly<Record<string, unknown>>
}

export interface StoredVideoJob {
  readonly job: VideoJob
  readonly reference: Readonly<Record<string, unknown>>
}

export interface VideoJobStore {
  get(id: string): Promise<StoredVideoJob | undefined>
  put(value: StoredVideoJob): Promise<void>
}

export interface ImageJobStore {
  get(id: string): Promise<StoredImageJob | undefined>
  put(value: StoredImageJob): Promise<void>
}

export interface AudioJobStore {
  get(id: string): Promise<StoredAudioJob | undefined>
  put(value: StoredAudioJob): Promise<void>
}
