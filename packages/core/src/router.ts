import { randomUUID } from "node:crypto"
import { conflict, invalidRequest, notFound } from "./errors.js"
import { MemoryAudioJobStore, MemoryImageJobStore, MemoryVideoJobStore } from "./job-store.js"
import type {
  AudioCreateRequest,
  AudioJob,
  AudioJobStore,
  AuthorizationMethod,
  ImageCreateRequest,
  ImageJob,
  ImageJobStore,
  ProviderAdapter,
  ProviderAuthorizationCompletion,
  ProviderDescriptor,
  ProviderModel,
  VideoCreateRequest,
  VideoJob,
  VideoJobStore,
} from "./types.js"

export interface ShortDramaRouterOptions {
  readonly audioJobStore?: AudioJobStore
  readonly imageJobStore?: ImageJobStore
  readonly jobStore?: VideoJobStore
  readonly now?: () => Date
  readonly providers?: readonly ProviderAdapter[]
  readonly randomId?: () => string
}

function providerFromModel(model: string) {
  const separator = model.indexOf("/")
  return separator > 0 ? model.slice(0, separator) : undefined
}

function requireIdentifier(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) {
    throw invalidRequest(`${label} is invalid`)
  }
  return value
}

function requirePrompt(prompt: string) {
  const normalized = prompt.trim()
  if (normalized.length === 0 || Buffer.byteLength(normalized, "utf8") > 20_000) {
    throw invalidRequest("prompt must contain 1 to 20,000 UTF-8 bytes")
  }
  return normalized
}

export class ShortDramaRouter {
  readonly #audioJobStore: AudioJobStore
  readonly #imageJobStore: ImageJobStore
  readonly #jobStore: VideoJobStore
  readonly #now: () => Date
  readonly #providers = new Map<string, ProviderAdapter>()
  readonly #randomId: () => string

  constructor(options: ShortDramaRouterOptions = {}) {
    this.#audioJobStore = options.audioJobStore ?? new MemoryAudioJobStore()
    this.#imageJobStore = options.imageJobStore ?? new MemoryImageJobStore()
    this.#jobStore = options.jobStore ?? new MemoryVideoJobStore()
    this.#now = options.now ?? (() => new Date())
    this.#randomId = options.randomId ?? randomUUID
    for (const provider of options.providers ?? []) this.register(provider)
  }

  register(provider: ProviderAdapter) {
    const id = requireIdentifier(provider.metadata.id, "provider id")
    if (this.#providers.has(id)) {
      throw conflict(`provider ${id} is already registered`, "provider_exists")
    }
    this.#providers.set(id, provider)
    return this
  }

  provider(id: string) {
    const provider = this.#providers.get(id)
    if (!provider) throw notFound(`provider ${id} was not found`, "provider_not_found")
    return provider
  }

  async listProviders(options: { readonly probeAuthorization?: boolean; readonly signal?: AbortSignal } = {}) {
    const result: ProviderDescriptor[] = []
    for (const provider of this.#providers.values()) {
      result.push({
        ...provider.metadata,
        authorization: await provider.getAuthorizationStatus({
          probe: options.probeAuthorization ?? false,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      })
    }
    return result
  }

  async getProvider(id: string, options: { readonly probeAuthorization?: boolean; readonly signal?: AbortSignal } = {}) {
    const provider = this.provider(id)
    return {
      ...provider.metadata,
      authorization: await provider.getAuthorizationStatus({
        probe: options.probeAuthorization ?? false,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    } satisfies ProviderDescriptor
  }

  getProviderAuthorization(id: string, options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    return this.provider(id).getAuthorizationStatus(options)
  }

  async beginProviderAuthorization(id: string, method: AuthorizationMethod, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.beginAuthorization) {
      throw conflict(`provider ${id} does not support interactive authorization`, "authorization_unsupported")
    }
    return provider.beginAuthorization(method, signal)
  }

  async completeProviderAuthorization(id: string, completion: ProviderAuthorizationCompletion, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.completeAuthorization) {
      throw conflict(`provider ${id} does not support interactive authorization`, "authorization_unsupported")
    }
    return provider.completeAuthorization(completion, signal)
  }

  async clearProviderAuthorization(id: string, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.clearAuthorization) {
      throw conflict(`provider ${id} does not support clearing authorization`, "authorization_unsupported")
    }
    await provider.clearAuthorization(signal)
  }

  async listProviderModels(providerId: string, signal?: AbortSignal): Promise<readonly ProviderModel[]> {
    return this.provider(providerId).listModels(signal === undefined ? {} : { signal })
  }

  async createAudio(request: AudioCreateRequest, signal?: AbortSignal): Promise<AudioJob> {
    const modelProvider = providerFromModel(request.model)
    const providerId = request.provider ?? modelProvider
    if (!providerId) throw invalidRequest("provider is required when model has no provider prefix")
    requireIdentifier(providerId, "provider")
    if (modelProvider && modelProvider !== providerId) throw invalidRequest("provider does not match the model prefix")
    const provider = this.provider(providerId)
    if (!provider.createAudio) {
      throw conflict(`provider ${providerId} does not support audio generation`, "audio_generation_unsupported")
    }
    const result = await provider.createAudio({
      ...request,
      prompt: requirePrompt(request.prompt),
      provider: providerId,
    }, signal)
    const timestamp = this.#now().toISOString()
    const job: AudioJob = {
      created_at: timestamp,
      id: this.#randomId(),
      model: request.model,
      provider: providerId,
      status: result.status,
      updated_at: timestamp,
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.outputs === undefined ? {} : { outputs: result.outputs }),
    }
    await this.#audioJobStore.put({ job, reference: result.reference })
    return job
  }

  async getAudio(id: string, signal?: AbortSignal): Promise<AudioJob> {
    const stored = await this.#audioJobStore.get(id)
    if (!stored) throw notFound(`audio job ${id} was not found`, "audio_not_found")
    const provider = this.provider(stored.job.provider)
    if (!provider.getAudio) {
      throw conflict(`provider ${stored.job.provider} does not support audio generation`, "audio_generation_unsupported")
    }
    const result = await provider.getAudio(stored.reference, signal)
    const job: AudioJob = {
      ...stored.job,
      status: result.status,
      updated_at: this.#now().toISOString(),
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.outputs === undefined ? {} : { outputs: result.outputs }),
    }
    await this.#audioJobStore.put({ job, reference: result.reference })
    return job
  }

  async createImage(request: ImageCreateRequest, signal?: AbortSignal): Promise<ImageJob> {
    const modelProvider = providerFromModel(request.model)
    const providerId = request.provider ?? modelProvider
    if (!providerId) {
      throw invalidRequest("provider is required when model has no provider prefix")
    }
    requireIdentifier(providerId, "provider")
    if (modelProvider && modelProvider !== providerId) {
      throw invalidRequest("provider does not match the model prefix")
    }
    if (request.n !== undefined && (!Number.isSafeInteger(request.n) || request.n < 1 || request.n > 10)) {
      throw invalidRequest("n must be an integer from 1 to 10")
    }
    const provider = this.provider(providerId)
    if (!provider.createImage) {
      throw conflict(`provider ${providerId} does not support image generation`, "image_generation_unsupported")
    }
    const result = await provider.createImage(
      { ...request, prompt: requirePrompt(request.prompt), provider: providerId },
      signal,
    )
    const timestamp = this.#now().toISOString()
    const job: ImageJob = {
      created_at: timestamp,
      id: this.#randomId(),
      model: request.model,
      provider: providerId,
      status: result.status,
      updated_at: timestamp,
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.outputs === undefined ? {} : { outputs: result.outputs }),
    }
    await this.#imageJobStore.put({ job, reference: result.reference })
    return job
  }

  async getImage(id: string, signal?: AbortSignal): Promise<ImageJob> {
    const stored = await this.#imageJobStore.get(id)
    if (!stored) throw notFound(`image job ${id} was not found`, "image_not_found")
    const provider = this.provider(stored.job.provider)
    if (!provider.getImage) {
      throw conflict(`provider ${stored.job.provider} does not support image generation`, "image_generation_unsupported")
    }
    const result = await provider.getImage(stored.reference, signal)
    const job: ImageJob = {
      ...stored.job,
      status: result.status,
      updated_at: this.#now().toISOString(),
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.outputs === undefined ? {} : { outputs: result.outputs }),
    }
    await this.#imageJobStore.put({ job, reference: result.reference })
    return job
  }

  async createVideo(request: VideoCreateRequest, signal?: AbortSignal): Promise<VideoJob> {
    const modelProvider = providerFromModel(request.model)
    const providerId = request.provider ?? modelProvider
    if (!providerId) {
      throw invalidRequest("provider is required when model has no provider prefix")
    }
    requireIdentifier(providerId, "provider")
    if (modelProvider && modelProvider !== providerId) {
      throw invalidRequest("provider does not match the model prefix")
    }
    const provider = this.provider(providerId)
    const result = await provider.createVideo(
      { ...request, prompt: requirePrompt(request.prompt), provider: providerId },
      signal,
    )
    const timestamp = this.#now().toISOString()
    const job: VideoJob = {
      created_at: timestamp,
      id: this.#randomId(),
      model: request.model,
      provider: providerId,
      status: result.status,
      updated_at: timestamp,
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.outputs === undefined ? {} : { outputs: result.outputs }),
    }
    await this.#jobStore.put({ job, reference: result.reference })
    return job
  }

  async getVideo(id: string, signal?: AbortSignal): Promise<VideoJob> {
    const stored = await this.#jobStore.get(id)
    if (!stored) throw notFound(`video job ${id} was not found`, "video_not_found")
    const provider = this.provider(stored.job.provider)
    const result = await provider.getVideo(stored.reference, signal)
    const job: VideoJob = {
      ...stored.job,
      status: result.status,
      updated_at: this.#now().toISOString(),
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.outputs === undefined ? {} : { outputs: result.outputs }),
    }
    await this.#jobStore.put({ job, reference: result.reference })
    return job
  }
}
