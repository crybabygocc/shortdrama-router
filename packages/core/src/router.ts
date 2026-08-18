import { randomUUID } from "node:crypto"
import { conflict, invalidRequest, notFound, RouterError, unsupported } from "./errors.js"
import { normalizeArtifacts, legacyOutputs } from "./artifacts.js"
import { assertStatusTransition, isTerminalStatus } from "./job-state.js"
import { MemoryAudioJobStore, MemoryImageJobStore, MemoryVideoJobStore } from "./job-store.js"
import { idempotencyKeyHash, requestFingerprint } from "./request-fingerprint.js"
import type {
  AudioCreateRequest,
  AudioJob,
  AudioJobStore,
  AuthorizationMethod,
  ImageCreateRequest,
  ImageJob,
  ImageJobStore,
  JobClaimResult,
  ProviderAdapter,
  ProviderAssetIngestionRequest,
  ProviderAuthorizationCompletion,
  ProviderAuthorizationOverview,
  ProviderAuthorizationStatus,
  ProviderConfigurationSelection,
  ProviderDescriptor,
  ProviderModel,
  StoredAudioJob,
  StoredImageJob,
  StoredVideoJob,
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

type StoredGenerationJob = StoredAudioJob | StoredImageJob | StoredVideoJob
type GenerationJob = AudioJob | ImageJob | VideoJob
type GenerationStore = AudioJobStore | ImageJobStore | VideoJobStore

function providerFromModel(model: string) {
  const separator = model.indexOf("/")
  return separator > 0 ? model.slice(0, separator) : undefined
}

function requireIdentifier(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) throw invalidRequest(`${label} is invalid`)
  return value
}

function requirePrompt(prompt: string) {
  const normalized = prompt.trim()
  if (normalized.length === 0 || Buffer.byteLength(normalized, "utf8") > 20_000) {
    throw invalidRequest("prompt must contain 1 to 20,000 UTF-8 bytes")
  }
  return normalized
}

function validateReferences(provider: string, request: AudioCreateRequest | ImageCreateRequest | VideoCreateRequest) {
  const references = "input_references" in request ? request.input_references ?? [] : []
  const providerAssets = references.map(reference => "provider_asset" in reference ? reference.provider_asset : reference)
  if ("frame_images" in request && request.frame_images) {
    if (request.frame_images.first_frame) providerAssets.push(request.frame_images.first_frame)
    if (request.frame_images.last_frame) providerAssets.push(request.frame_images.last_frame)
  }
  for (const reference of providerAssets) {
    if (reference.provider !== undefined && reference.provider !== provider) {
      throw invalidRequest("asset reference belongs to a different provider", "cross_provider_reference")
    }
    if (!reference.id && !reference.pippit_asset_id && !reference.asset_id) {
      throw invalidRequest("asset reference id is required", "invalid_asset_reference")
    }
  }
}

function safeAuthorizationError(provider: ProviderAdapter, error: unknown): ProviderAuthorizationStatus {
  return {
    authorized: null,
    configured: false,
    method: provider.metadata.capabilities.authorization[0] ?? null,
    reason: "authorization status could not be inspected",
    reason_code: error instanceof RouterError ? error.code : "authorization_inspection_failed",
    state: "error",
    verified_at: new Date().toISOString(),
  }
}

function effectiveAuthorization(overview: ProviderAuthorizationOverview) {
  return overview.methods.find(status => status.method === overview.effective_method)
    ?? overview.methods.find(status => status.authorized === true)
    ?? overview.methods[0]
    ?? { authorized: false, configured: false, method: null, state: "not_configured" as const }
}

function defaultAvailability(model: ProviderModel, overview: ProviderAuthorizationOverview, now: string) {
  if (model.availability) return model
  const accepted = model.capabilities.authorization ?? overview.methods.flatMap(status => status.method ? [status.method] : [])
  const statuses = overview.methods.filter(status => status.method !== null && accepted.includes(status.method))
  const valid = statuses.some(status => status.state === "valid" || status.state === "expiring")
  const potentiallyValid = statuses.some(status => status.state === "configured" || status.state === "error")
  return {
    ...model,
    availability: valid
      ? { observed_at: now, state: "available" as const }
      : potentiallyValid
        ? { observed_at: now, reason: "authorization has not been verified", reason_code: "authorization_unverified", state: "unknown" as const }
        : { observed_at: now, reason: "a supported authorization method is required", reason_code: "authorization_required", state: "unavailable" as const },
  }
}

function providerReadinessAvailability(model: ProviderModel, descriptor: ProviderDescriptor, now: string) {
  const authorizationAvailability = defaultAvailability(model, descriptor.authorizations ?? {
    effective_method: descriptor.authorization.method,
    methods: [descriptor.authorization],
  }, now)
  if (authorizationAvailability.availability?.state === "unavailable") return authorizationAvailability
  if (descriptor.configuration && descriptor.configuration.state !== "not_required") {
    if (descriptor.configuration.state === "configuration_required" || descriptor.configuration.state === "configuration_unavailable") {
      return {
        ...authorizationAvailability,
        availability: {
          observed_at: now,
          reason: descriptor.configuration.reason ?? "provider configuration is required",
          reason_code: descriptor.configuration.reason_code ?? "configuration_required",
          state: "unavailable" as const,
        },
      }
    }
    if (descriptor.configuration.state === "configuration_configured" || descriptor.configuration.state === "error") {
      return {
        ...authorizationAvailability,
        availability: {
          observed_at: now,
          reason: descriptor.configuration.reason ?? "provider configuration has not been verified",
          reason_code: descriptor.configuration.reason_code ?? "configuration_unverified",
          state: "unknown" as const,
        },
      }
    }
  }
  const unavailableDependency = descriptor.dependency_statuses?.find(status => status.available !== true)
  if (unavailableDependency) {
    const unprobed = unavailableDependency.reason_code === "dependency_unprobed"
    return {
      ...authorizationAvailability,
      availability: {
        observed_at: now,
        reason: unavailableDependency.reason ?? (unprobed ? "provider dependency has not been probed" : "provider dependency is unavailable"),
        reason_code: unavailableDependency.reason_code ?? "dependency_unavailable",
        state: unprobed ? "unknown" as const : "unavailable" as const,
      },
    }
  }
  return authorizationAvailability
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
    if (this.#providers.has(id)) throw conflict(`provider ${id} is already registered`, "provider_exists")
    this.#providers.set(id, provider)
    return this
  }

  provider(id: string) {
    const provider = this.#providers.get(id)
    if (!provider) throw notFound(`provider ${id} was not found`, "provider_not_found")
    return provider
  }

  async #authorizationOverview(provider: ProviderAdapter, probe: boolean, signal?: AbortSignal) {
    try {
      if (provider.getAuthorizationStatuses) return await provider.getAuthorizationStatuses({ probe, ...(signal ? { signal } : {}) })
      const status = await provider.getAuthorizationStatus({ probe, ...(signal ? { signal } : {}) })
      return { effective_method: status.method, methods: [status] } satisfies ProviderAuthorizationOverview
    } catch (error) {
      const status = safeAuthorizationError(provider, error)
      return { effective_method: status.method, methods: [status] } satisfies ProviderAuthorizationOverview
    }
  }

  async #descriptor(provider: ProviderAdapter, options: {
    readonly probeAuthorization?: boolean
    readonly probeConfiguration?: boolean
    readonly probeDependencies?: boolean
    readonly signal?: AbortSignal
  }): Promise<ProviderDescriptor> {
    const authorizations = await this.#authorizationOverview(provider, options.probeAuthorization ?? false, options.signal)
    let configuration
    if (provider.getConfigurationStatus) {
      try {
        configuration = await provider.getConfigurationStatus({ probe: options.probeConfiguration ?? false, ...(options.signal ? { signal: options.signal } : {}) })
      } catch (error) {
        configuration = {
          configured: false,
          reason: "provider configuration could not be inspected",
          reason_code: error instanceof RouterError ? error.code : "configuration_inspection_failed",
          state: "error" as const,
          verified_at: this.#now().toISOString(),
        }
      }
    }
    let dependencyStatuses
    if (provider.getDependencyStatuses) {
      try {
        dependencyStatuses = await provider.getDependencyStatuses({ probe: options.probeDependencies ?? false, ...(options.signal ? { signal: options.signal } : {}) })
      } catch (error) {
        dependencyStatuses = (provider.metadata.dependencies ?? []).map(dependency => ({
          ...dependency,
          available: false,
          compatible: null,
          reason: "provider dependency could not be inspected",
          reason_code: error instanceof RouterError ? error.code : "dependency_inspection_failed",
        }))
      }
    }
    return {
      ...provider.metadata,
      authorization: effectiveAuthorization(authorizations),
      authorizations,
      ...(configuration ? { configuration } : {}),
      ...(dependencyStatuses ? { dependency_statuses: dependencyStatuses } : {}),
    }
  }

  async listProviders(options: {
    readonly probeAuthorization?: boolean
    readonly probeConfiguration?: boolean
    readonly probeDependencies?: boolean
    readonly signal?: AbortSignal
  } = {}) {
    const result: ProviderDescriptor[] = []
    for (const provider of this.#providers.values()) result.push(await this.#descriptor(provider, options))
    return result
  }

  getProvider(id: string, options: {
    readonly probeAuthorization?: boolean
    readonly probeConfiguration?: boolean
    readonly probeDependencies?: boolean
    readonly signal?: AbortSignal
  } = {}) {
    return this.#descriptor(this.provider(id), options)
  }

  getProviderAuthorization(id: string, options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    return this.provider(id).getAuthorizationStatus(options)
  }

  getProviderAuthorizations(id: string, options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    return this.#authorizationOverview(this.provider(id), options.probe ?? false, options.signal)
  }

  async beginProviderAuthorization(id: string, method: AuthorizationMethod, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.beginAuthorization) throw unsupported(`provider ${id} does not manage interactive authorization`, "authorization_externally_managed")
    return provider.beginAuthorization(method, signal)
  }

  async completeProviderAuthorization(id: string, completion: ProviderAuthorizationCompletion, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.completeAuthorization) throw unsupported(`provider ${id} does not manage interactive authorization`, "authorization_externally_managed")
    return provider.completeAuthorization(completion, signal)
  }

  async cancelProviderAuthorization(id: string, authorizationId: string, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.cancelAuthorization) throw unsupported(`provider ${id} does not support cancelling authorization`, "authorization_cancellation_unsupported")
    await provider.cancelAuthorization(authorizationId, signal)
  }

  async clearProviderAuthorization(id: string, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.clearAuthorization) throw unsupported(`provider ${id} does not support clearing authorization`, "authorization_unsupported")
    await provider.clearAuthorization(signal)
  }

  async clearProviderAuthorizationMethod(id: string, method: AuthorizationMethod, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (provider.clearAuthorizationMethod) return provider.clearAuthorizationMethod(method, signal)
    if (provider.metadata.capabilities.authorization.length === 1 && provider.metadata.capabilities.authorization[0] === method) {
      return this.clearProviderAuthorization(id, signal)
    }
    throw unsupported(`provider ${id} does not support method-scoped authorization clearing`, "authorization_clear_unsupported")
  }

  async getProviderConfiguration(id: string, options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    const provider = this.provider(id)
    if (!provider.getConfigurationStatus) return { configured: true, state: "not_required" as const }
    return provider.getConfigurationStatus(options)
  }

  async listProviderResources(id: string, type?: string, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.listResources) throw unsupported(`provider ${id} does not expose configurable resources`, "resource_discovery_unsupported")
    return provider.listResources({ ...(type ? { type } : {}), ...(signal ? { signal } : {}) })
  }

  async configureProvider(id: string, selection: ProviderConfigurationSelection, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.configure) throw unsupported(`provider ${id} does not expose configurable resources`, "configuration_unsupported")
    return provider.configure(selection, signal)
  }

  async clearProviderConfiguration(id: string, signal?: AbortSignal) {
    const provider = this.provider(id)
    if (!provider.clearConfiguration) throw unsupported(`provider ${id} does not expose configurable resources`, "configuration_unsupported")
    await provider.clearConfiguration(signal)
  }

  async listProviderModels(providerId: string, signal?: AbortSignal, probe = false): Promise<readonly ProviderModel[]> {
    const provider = this.provider(providerId)
    const [models, descriptor] = await Promise.all([
      provider.listModels(signal ? { signal } : {}),
      this.#descriptor(provider, {
        probeAuthorization: probe,
        probeConfiguration: probe,
        probeDependencies: probe,
        ...(signal ? { signal } : {}),
      }),
    ])
    const now = this.#now().toISOString()
    return models.map(model => providerReadinessAvailability(model, descriptor, now))
  }

  async ingestProviderAsset(providerId: string, request: ProviderAssetIngestionRequest, signal?: AbortSignal) {
    const provider = this.provider(providerId)
    if (!provider.ingestAsset) throw unsupported(`provider ${providerId} does not support media ingestion`, "ingestion_unsupported")
    return provider.ingestAsset(request, signal)
  }

  async deleteProviderAsset(providerId: string, reference: Parameters<NonNullable<ProviderAdapter["deleteAsset"]>>[0], signal?: AbortSignal) {
    const provider = this.provider(providerId)
    if (!provider.deleteAsset) throw unsupported(`provider ${providerId} does not support asset cleanup`, "asset_cleanup_unsupported")
    await provider.deleteAsset(reference, signal)
  }

  async #claim<T extends StoredGenerationJob>(store: GenerationStore, value: T): Promise<JobClaimResult<T>> {
    if (value.idempotency_key && !store.claim) {
      throw unsupported("configured job store cannot atomically claim idempotency keys", "idempotency_unsupported")
    }
    if (store.claim) return await store.claim(value as never) as JobClaimResult<T>
    await store.put(value as never)
    return { created: true, value }
  }

  async #persist(store: GenerationStore, previous: StoredGenerationJob, next: StoredGenerationJob) {
    if (previous.version !== undefined && store.compareAndSet) {
      const updated = await store.compareAndSet(previous.job.id, previous.version, next as never)
      if (!updated) return store.get(previous.job.id) as Promise<StoredGenerationJob | undefined>
      return store.get(previous.job.id) as Promise<StoredGenerationJob | undefined>
    }
    await store.put(next as never)
    return next
  }

  #providerRequest<T extends AudioCreateRequest | ImageCreateRequest | VideoCreateRequest>(request: T, provider: string) {
    const { idempotency_key: _idempotencyKey, ...providerRequest } = request
    return { ...providerRequest, prompt: requirePrompt(request.prompt), provider }
  }

  async createAudio(request: AudioCreateRequest, signal?: AbortSignal): Promise<AudioJob> {
    return this.#create("audio", request, this.#audioJobStore, signal) as Promise<AudioJob>
  }

  async createImage(request: ImageCreateRequest, signal?: AbortSignal): Promise<ImageJob> {
    if (request.n !== undefined && (!Number.isSafeInteger(request.n) || request.n < 1 || request.n > 10)) {
      throw invalidRequest("n must be an integer from 1 to 10")
    }
    return this.#create("image", request, this.#imageJobStore, signal) as Promise<ImageJob>
  }

  async createVideo(request: VideoCreateRequest, signal?: AbortSignal): Promise<VideoJob> {
    return this.#create("video", request, this.#jobStore, signal) as Promise<VideoJob>
  }

  async #create(
    kind: "audio" | "image" | "video",
    request: AudioCreateRequest | ImageCreateRequest | VideoCreateRequest,
    store: GenerationStore,
    signal?: AbortSignal,
  ): Promise<GenerationJob> {
    const modelProvider = providerFromModel(request.model)
    const providerId = request.provider ?? modelProvider
    if (!providerId) throw invalidRequest("provider is required when model has no provider prefix")
    requireIdentifier(providerId, "provider")
    if (modelProvider && modelProvider !== providerId) throw invalidRequest("provider does not match the model prefix")
    validateReferences(providerId, request)
    const provider = this.provider(providerId)
    const create = kind === "audio" ? provider.createAudio : kind === "image" ? provider.createImage : provider.createVideo
    if (!create) throw unsupported(`provider ${providerId} does not support ${kind} generation`, `${kind}_generation_unsupported`)
    const providerRequest = this.#providerRequest(request, providerId)
    const timestamp = this.#now().toISOString()
    const idempotencyKey = idempotencyKeyHash(request.idempotency_key)
    const job: GenerationJob = {
      created_at: timestamp,
      id: this.#randomId(),
      model: request.model,
      provider: providerId,
      status: "submitting",
      updated_at: timestamp,
    }
    const claimed = await this.#claim(store, {
      job,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      request_hash: requestFingerprint({ kind, request: providerRequest }),
    })
    if (!claimed.created) return claimed.value.job
    try {
      const result = await create.call(provider, providerRequest as never, signal)
      assertStatusTransition("submitting", result.status)
      const artifacts = normalizeArtifacts(kind, result.artifacts, result.outputs)
      const completed: GenerationJob = {
        ...job,
        status: result.status,
        updated_at: this.#now().toISOString(),
        ...(result.error ? { error: result.error } : {}),
        ...(artifacts.length ? { artifacts, outputs: legacyOutputs(artifacts) } : {}),
      }
      const persisted = await this.#persist(store, claimed.value, { ...claimed.value, job: completed, reference: result.reference })
      return persisted?.job ?? completed
    } catch (error) {
      const uncertain = signal?.aborted || (error instanceof RouterError && (error.category === "provider_failure" || error.category === "timeout"))
      const failed: GenerationJob = {
        ...job,
        error: uncertain
          ? {
            category: "provider_failure",
            code: "submission_unknown",
            message: "provider acceptance could not be confirmed; the request was not retried",
            provider: providerId,
            retryable: false,
          }
          : error instanceof RouterError
            ? {
              category: error.category,
              code: error.code,
              message: error.message,
              ...(error.provider ? { provider: error.provider } : {}),
              ...(error.providerCode ? { provider_code: error.providerCode } : {}),
              retryable: error.retryable,
            }
            : { category: "internal", code: "generation_failed", message: error instanceof Error ? error.message : "generation failed", retryable: false },
        status: uncertain ? "submission_unknown" : "failed",
        updated_at: this.#now().toISOString(),
      }
      await this.#persist(store, claimed.value, { ...claimed.value, job: failed })
      if (uncertain) return failed
      throw error
    }
  }

  getAudio(id: string, signal?: AbortSignal) { return this.#get("audio", id, this.#audioJobStore, signal) as Promise<AudioJob> }
  getImage(id: string, signal?: AbortSignal) { return this.#get("image", id, this.#imageJobStore, signal) as Promise<ImageJob> }
  getVideo(id: string, signal?: AbortSignal) { return this.#get("video", id, this.#jobStore, signal) as Promise<VideoJob> }

  async #get(kind: "audio" | "image" | "video", id: string, store: GenerationStore, signal?: AbortSignal) {
    const stored = await store.get(id) as StoredGenerationJob | undefined
    if (!stored) throw notFound(`${kind} job ${id} was not found`, `${kind}_not_found`)
    if (isTerminalStatus(stored.job.status) || stored.job.status === "submission_unknown") return stored.job
    if (!stored.reference) {
      const unknown: GenerationJob = {
        ...stored.job,
        error: {
          category: "provider_failure",
          code: "submission_unknown",
          message: "provider acceptance could not be confirmed; the request was not retried",
          provider: stored.job.provider,
          retryable: false,
        },
        status: "submission_unknown" as const,
        updated_at: this.#now().toISOString(),
      }
      const persisted = await this.#persist(store, stored, { ...stored, job: unknown })
      return persisted?.job ?? unknown
    }
    const provider = this.provider(stored.job.provider)
    const get = kind === "audio" ? provider.getAudio : kind === "image" ? provider.getImage : provider.getVideo
    if (!get) throw unsupported(`provider ${stored.job.provider} does not support ${kind} generation`, `${kind}_generation_unsupported`)
    const result = await get.call(provider, stored.reference, signal)
    assertStatusTransition(stored.job.status, result.status)
    const artifacts = normalizeArtifacts(kind, result.artifacts, result.outputs)
    const next: GenerationJob = {
      ...stored.job,
      status: result.status,
      updated_at: this.#now().toISOString(),
      ...(result.error ? { error: result.error } : {}),
      ...(artifacts.length ? { artifacts, outputs: legacyOutputs(artifacts) } : {}),
    }
    const persisted = await this.#persist(store, stored, { ...stored, job: next, reference: result.reference })
    return persisted?.job ?? next
  }

  cancelAudio(id: string, signal?: AbortSignal) { return this.#cancel("audio", id, this.#audioJobStore, signal) as Promise<AudioJob> }
  cancelImage(id: string, signal?: AbortSignal) { return this.#cancel("image", id, this.#imageJobStore, signal) as Promise<ImageJob> }
  cancelVideo(id: string, signal?: AbortSignal) { return this.#cancel("video", id, this.#jobStore, signal) as Promise<VideoJob> }

  async #cancel(kind: "audio" | "image" | "video", id: string, store: GenerationStore, signal?: AbortSignal) {
    const stored = await store.get(id) as StoredGenerationJob | undefined
    if (!stored) throw notFound(`${kind} job ${id} was not found`, `${kind}_not_found`)
    if (stored.job.status === "cancelled") return stored.job
    if (stored.job.status === "completed" || stored.job.status === "failed") {
      throw conflict(`${kind} job ${id} is already terminal`, "job_not_cancellable")
    }
    if (!stored.reference || stored.job.status === "submission_unknown") {
      throw unsupported(`${kind} job ${id} cannot be cancelled safely`, "cancellation_unsupported")
    }
    const provider = this.provider(stored.job.provider)
    const cancel = kind === "audio" ? provider.cancelAudio : kind === "image" ? provider.cancelImage : provider.cancelVideo
    if (!cancel) throw unsupported(`provider ${stored.job.provider} does not support ${kind} cancellation`, "cancellation_unsupported")
    const result = await cancel.call(provider, stored.reference, signal)
    if (result.status !== "cancelled") throw new RouterError("provider_cancellation_failed", "provider did not confirm cancellation", 502)
    assertStatusTransition(stored.job.status, "cancelled")
    const next = { ...stored.job, status: "cancelled" as const, updated_at: this.#now().toISOString() }
    const persisted = await this.#persist(store, stored, { ...stored, job: next, reference: result.reference })
    return persisted?.job ?? next
  }
}
