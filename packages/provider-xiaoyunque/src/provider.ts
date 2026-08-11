import { randomUUID } from "node:crypto"
import type {
  AudioCreateRequest,
  AuthorizationMethod,
  ImageCreateRequest,
  ProviderAdapter,
  ProviderAuthorizationCompletion,
  ProviderAuthorizationStatus,
  ProviderAudioJobResult,
  ProviderVideoJobResult,
  VideoCreateRequest,
} from "@shortdrama-router/core"
import {
  publicXiaoYunqueModel,
  resolveXiaoYunqueAudioModel,
  resolveXiaoYunqueImageModel,
  resolveXiaoYunqueVideoModel,
  validateXiaoYunqueAudioRequest,
  validateXiaoYunqueImageRequest,
  validateXiaoYunqueVideoRequest,
  XIAOYUNQUE_MODELS,
} from "./catalog.js"
import {
  MemoryXiaoYunqueCredentials,
  normalizeWebSession,
  webSessionCookieHeader,
  webSessionExpiry,
  XIAOYUNQUE_COOKIE_ORIGIN,
  XIAOYUNQUE_SESSION_COOKIE_NAMES,
  type XiaoYunqueCredentialSnapshot,
  type XiaoYunqueCredentialSource,
} from "./credentials.js"
import { XiaoYunqueAccessKeyTransport } from "./access-key-transport.js"
import {
  XiaoYunqueAuthenticationError,
  XiaoYunqueInputError,
  XiaoYunqueUpstreamError,
} from "./errors.js"
import type { FetchLike } from "./http-client.js"
import {
  credentialFingerprint,
  type XiaoYunqueCredential,
  type XiaoYunqueTransport,
} from "./transport.js"
import { XiaoYunqueWebSessionTransport } from "./web-session-transport.js"
import {
  XiaoYunqueAccessKeyEnrollmentClient,
  type XiaoYunqueAccessKeyEnrollmentOptions,
} from "./access-key-enrollment.js"

const authorizationLifetimeMs = 30 * 60_000
const expiringWindowMs = 7 * 24 * 60 * 60_000

interface AuthorizationObservation {
  readonly reason?: string
  readonly state: "valid" | "expired" | "error"
  readonly verifiedAt: string
}

interface PendingAuthorization {
  readonly expiresAt: number
  readonly id: string
  readonly method: "api_key" | "browser_session"
}

export interface XiaoYunqueProviderOptions {
  readonly accessKey?: string | undefined
  readonly accessKeyEnrollment?: XiaoYunqueAccessKeyEnrollmentOptions
  readonly baseUrl?: string
  readonly credentials?: XiaoYunqueCredentialSource
  readonly fetch?: FetchLike
  readonly now?: () => Date
}

function officialOrLoopbackBaseUrl(value: string | undefined) {
  const url = new URL(value ?? XIAOYUNQUE_COOKIE_ORIGIN)
  const exactShape = !url.username && !url.password && !url.search && !url.hash && url.pathname === "/"
  const official = exactShape && url.origin === XIAOYUNQUE_COOKIE_ORIGIN
  const loopback = exactShape && url.protocol === "http:" && url.hostname === "127.0.0.1"
  if (!official && !loopback) throw new Error("XiaoYunque API origin is invalid")
  return url
}

function safeReason(error: unknown) {
  if (error instanceof XiaoYunqueAuthenticationError) return "authorization rejected by XiaoYunque"
  if (error instanceof XiaoYunqueUpstreamError) return "XiaoYunque authorization could not be verified"
  return "XiaoYunque authorization inspection failed"
}

function status(
  state: ProviderAuthorizationStatus["state"],
  method: ProviderAuthorizationStatus["method"],
  options: {
    readonly expiresAt?: number
    readonly reason?: string
    readonly verifiedAt?: string
  } = {},
): ProviderAuthorizationStatus {
  return {
    authorized: state === "valid" || state === "expiring" ? true : state === "expired" || state === "not_configured" ? false : null,
    configured: state !== "not_configured",
    method,
    state,
    ...(options.expiresAt === undefined ? {} : { expires_at: new Date(options.expiresAt).toISOString() }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.verifiedAt === undefined ? {} : { verified_at: options.verifiedAt }),
  }
}

export class XiaoYunqueProvider implements ProviderAdapter {
  readonly metadata = {
    capabilities: {
      authorization: ["api_key", "browser_session"],
      generation: ["audio", "image", "video"],
      models: true,
      usage: false,
    },
    description: "XiaoYunque short-drama audio, image and video generation service.",
    id: "xiaoyunque",
    name: "XiaoYunque",
  } as const

  readonly #accessKeyTransport: XiaoYunqueTransport
  readonly #accessKeyEnrollment: XiaoYunqueAccessKeyEnrollmentClient
  readonly #accessKeyEnrollmentOptions: XiaoYunqueAccessKeyEnrollmentOptions
  readonly #credentials: XiaoYunqueCredentialSource
  readonly #now: () => Date
  readonly #observations = new Map<AuthorizationMethod, AuthorizationObservation>()
  #pendingAuthorization: PendingAuthorization | undefined
  readonly #webSessionTransport: XiaoYunqueTransport

  constructor(options: XiaoYunqueProviderOptions = {}) {
    const baseUrl = officialOrLoopbackBaseUrl(options.baseUrl)
    const fetchLike = options.fetch ?? fetch
    this.#credentials = options.credentials ?? new MemoryXiaoYunqueCredentials({
      ...(options.accessKey === undefined ? {} : { access_key: options.accessKey }),
    })
    this.#now = options.now ?? (() => new Date())
    this.#accessKeyTransport = new XiaoYunqueAccessKeyTransport({ baseUrl, fetch: fetchLike })
    this.#accessKeyEnrollment = new XiaoYunqueAccessKeyEnrollmentClient({ baseUrl, fetch: fetchLike })
    this.#accessKeyEnrollmentOptions = { ...options.accessKeyEnrollment }
    this.#webSessionTransport = new XiaoYunqueWebSessionTransport({ baseUrl, fetch: fetchLike })
  }

  async listModels() {
    return XIAOYUNQUE_MODELS.map(publicXiaoYunqueModel)
  }

  async getAuthorizationStatus(options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    const snapshot = await this.#credentials.read()
    const selected = this.#selectedCredential(snapshot)
    if (!selected) return status("not_configured", null)
    const expiry = selected.credential.mode === "api_key" && snapshot.access_key_expires_at
      ? new Date(snapshot.access_key_expires_at).getTime()
      : selected.credential.mode === "browser_session" && snapshot.web_session
        ? webSessionExpiry(snapshot.web_session)
        : undefined
    if (expiry !== undefined && expiry <= this.#now().getTime()) {
      return status("expired", selected.credential.mode, {
        expiresAt: expiry,
        reason: selected.credential.mode === "api_key"
          ? "the locally recorded Access Key lifetime has ended"
          : "local Web session cookies have expired",
      })
    }
    if (options.probe) {
      try {
        await selected.transport.probe(selected.credential, options.signal)
        this.#observe(selected.credential.mode, "valid")
      } catch (error) {
        if (error instanceof XiaoYunqueAuthenticationError) {
          this.#observe(selected.credential.mode, "expired", safeReason(error))
        } else if (options.signal?.aborted) {
          throw error
        } else {
          this.#observe(selected.credential.mode, "error", safeReason(error))
        }
      }
    }
    const observation = this.#observations.get(selected.credential.mode)
    if (observation?.state === "expired") {
      return status("expired", selected.credential.mode, {
        ...(expiry === undefined ? {} : { expiresAt: expiry }),
        ...(observation.reason === undefined ? {} : { reason: observation.reason }),
        verifiedAt: observation.verifiedAt,
      })
    }
    if (observation?.state === "error") {
      return status("error", selected.credential.mode, {
        ...(expiry === undefined ? {} : { expiresAt: expiry }),
        ...(observation.reason === undefined ? {} : { reason: observation.reason }),
        verifiedAt: observation.verifiedAt,
      })
    }
    if (observation?.state === "valid") {
      const state = expiry !== undefined && expiry - this.#now().getTime() <= expiringWindowMs ? "expiring" : "valid"
      return status(state, selected.credential.mode, {
        ...(expiry === undefined ? {} : { expiresAt: expiry }),
        verifiedAt: observation.verifiedAt,
      })
    }
    return status("configured", selected.credential.mode, expiry === undefined ? {} : { expiresAt: expiry })
  }

  async beginAuthorization(method: AuthorizationMethod) {
    if (method !== "api_key" && method !== "browser_session") {
      throw new XiaoYunqueInputError("interactive authorization method is unsupported")
    }
    if (method === "api_key" && !this.#credentials.setAccessKey) throw new XiaoYunqueInputError("the configured credential source cannot save an Access Key")
    if (method === "browser_session" && !this.#credentials.setWebSession) throw new XiaoYunqueInputError("the configured credential source cannot save a Web session")
    const now = this.#now().getTime()
    const pending = { expiresAt: now + authorizationLifetimeMs, id: randomUUID(), method }
    this.#pendingAuthorization = pending
    return {
      authorization_id: pending.id,
      cookie_names: XIAOYUNQUE_SESSION_COOKIE_NAMES,
      cookie_origin: XIAOYUNQUE_COOKIE_ORIGIN,
      expires_at: new Date(pending.expiresAt).toISOString(),
      login_url: `${XIAOYUNQUE_COOKIE_ORIGIN}/login?redirect_url=%2F`,
      method,
    } as const
  }

  async completeAuthorization(completion: ProviderAuthorizationCompletion, signal?: AbortSignal) {
    const pending = this.#pendingAuthorization
    if (
      (completion.method !== "api_key" && completion.method !== "browser_session")
      || !pending
      || pending.id !== completion.authorization_id
      || pending.method !== completion.method
      || pending.expiresAt <= this.#now().getTime()
      || completion.cookie_origin !== XIAOYUNQUE_COOKIE_ORIGIN
      || !completion.cookies
    ) {
      throw new XiaoYunqueInputError("XiaoYunque authorization completion is stale or invalid")
    }
    const webSession = normalizeWebSession({
      authorized_at: this.#now().toISOString(),
      cookies: completion.cookies,
    })
    if (!webSession) throw new XiaoYunqueInputError("XiaoYunque Web session is invalid")
    if (completion.method === "api_key") {
      if (!this.#credentials.setAccessKey) throw new XiaoYunqueInputError("the configured credential source cannot save an Access Key")
      const created = await this.#accessKeyEnrollment.create(
        webSession,
        this.#now(),
        this.#accessKeyEnrollmentOptions,
        signal,
      )
      await this.#credentials.setAccessKey(created.accessKey, created.expiresAt)
      this.#observations.delete("api_key")
    } else {
      if (!this.#credentials.setWebSession) throw new XiaoYunqueInputError("the configured credential source cannot save a Web session")
      await this.#credentials.setWebSession(webSession)
      this.#observations.delete("browser_session")
    }
    this.#pendingAuthorization = undefined
    return this.getAuthorizationStatus({ probe: true, ...(signal === undefined ? {} : { signal }) })
  }

  async clearAuthorization() {
    if (!this.#credentials.clear) throw new XiaoYunqueInputError("the configured credential source is read-only")
    await this.#credentials.clear()
    this.#pendingAuthorization = undefined
    this.#observations.clear()
  }

  async createAudio(request: AudioCreateRequest, signal?: AbortSignal): Promise<ProviderAudioJobResult> {
    const snapshot = await this.#credentials.read()
    const selected = this.#credentialForMode(snapshot, "browser_session")
    if (!selected || !selected.transport.createAudio) {
      throw new XiaoYunqueAuthenticationError("XiaoYunque Seed Audio generation requires a local browser session")
    }
    const model = resolveXiaoYunqueAudioModel(request.model)
    validateXiaoYunqueAudioRequest(model, request)
    try {
      const result = await selected.transport.createAudio(model, request, selected.credential, signal)
      this.#observe("browser_session", "valid")
      return result
    } catch (error) {
      this.#observeFailure("browser_session", error)
      throw error
    }
  }

  async getAudio(reference: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<ProviderAudioJobResult> {
    if (reference.transport !== "browser_session") throw new XiaoYunqueInputError("XiaoYunque audio job reference is invalid")
    const snapshot = await this.#credentials.read()
    const selected = this.#credentialForMode(snapshot, "browser_session")
    if (!selected || !selected.transport.getAudio) {
      throw new XiaoYunqueAuthenticationError("the browser session used by this XiaoYunque audio job is unavailable")
    }
    if (reference.credential_fingerprint !== credentialFingerprint(selected.credential)) {
      throw new XiaoYunqueAuthenticationError("the credential used by this XiaoYunque audio job has changed")
    }
    try {
      const result = await selected.transport.getAudio(reference, selected.credential, signal)
      this.#observe("browser_session", "valid")
      return result
    } catch (error) {
      this.#observeFailure("browser_session", error)
      throw error
    }
  }

  async createImage(request: ImageCreateRequest, signal?: AbortSignal) {
    const snapshot = await this.#credentials.read()
    const selected = this.#credentialForMode(snapshot, "api_key")
    if (!selected || !selected.transport.createImage) {
      throw new XiaoYunqueAuthenticationError("XiaoYunque image generation requires an Access Key")
    }
    const model = resolveXiaoYunqueImageModel(request.model)
    validateXiaoYunqueImageRequest(model, request)
    try {
      const result = await selected.transport.createImage(model, request, selected.credential, signal)
      this.#observe("api_key", "valid")
      return result
    } catch (error) {
      this.#observeFailure("api_key", error)
      throw error
    }
  }

  async getImage(reference: Readonly<Record<string, unknown>>, signal?: AbortSignal) {
    if (reference.transport !== "api_key") {
      throw new XiaoYunqueInputError("XiaoYunque image job reference is invalid")
    }
    const snapshot = await this.#credentials.read()
    const selected = this.#credentialForMode(snapshot, "api_key")
    if (!selected || !selected.transport.getImage) {
      throw new XiaoYunqueAuthenticationError("the Access Key used by this XiaoYunque image job is unavailable")
    }
    if (reference.credential_fingerprint !== credentialFingerprint(selected.credential)) {
      throw new XiaoYunqueAuthenticationError("the credential used by this XiaoYunque image job has changed")
    }
    try {
      const result = await selected.transport.getImage(reference, selected.credential, signal)
      this.#observe("api_key", "valid")
      return result
    } catch (error) {
      this.#observeFailure("api_key", error)
      throw error
    }
  }

  async createVideo(request: VideoCreateRequest, signal?: AbortSignal): Promise<ProviderVideoJobResult> {
    const snapshot = await this.#credentials.read()
    const selected = this.#selectedCredential(snapshot)
    if (!selected) throw new XiaoYunqueAuthenticationError("XiaoYunque is not authorized")
    const model = resolveXiaoYunqueVideoModel(request.model)
    validateXiaoYunqueVideoRequest(model, request)
    try {
      const result = await selected.transport.createVideo(model, request, selected.credential, signal)
      this.#observe(selected.credential.mode, "valid")
      return result
    } catch (error) {
      this.#observeFailure(selected.credential.mode, error)
      throw error
    }
  }

  async getVideo(reference: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<ProviderVideoJobResult> {
    const mode = reference.transport === "api_key"
      ? "api_key"
      : reference.transport === "browser_session"
        ? "browser_session"
        : undefined
    if (!mode) throw new XiaoYunqueInputError("XiaoYunque job reference is invalid")
    const snapshot = await this.#credentials.read()
    const selected = this.#credentialForMode(snapshot, mode)
    if (!selected) throw new XiaoYunqueAuthenticationError("the credential used by this XiaoYunque job is unavailable")
    if (reference.credential_fingerprint !== credentialFingerprint(selected.credential)) {
      throw new XiaoYunqueAuthenticationError("the credential used by this XiaoYunque job has changed")
    }
    try {
      const result = await selected.transport.getVideo(reference, selected.credential, signal)
      this.#observe(mode, "valid")
      return result
    } catch (error) {
      this.#observeFailure(mode, error)
      throw error
    }
  }

  #selectedCredential(snapshot: XiaoYunqueCredentialSnapshot) {
    return this.#credentialForMode(snapshot, snapshot.access_key ? "api_key" : "browser_session")
  }

  #credentialForMode(snapshot: XiaoYunqueCredentialSnapshot, mode: "api_key" | "browser_session") {
    if (mode === "api_key" && snapshot.access_key) {
      return {
        credential: { accessKey: snapshot.access_key, mode } satisfies XiaoYunqueCredential,
        transport: this.#accessKeyTransport,
      }
    }
    if (mode === "browser_session" && snapshot.web_session) {
      const cookie = webSessionCookieHeader(snapshot.web_session, this.#now().getTime())
      if (!cookie) return undefined
      return {
        credential: { cookie, mode } satisfies XiaoYunqueCredential,
        transport: this.#webSessionTransport,
      }
    }
    return undefined
  }

  #observe(method: AuthorizationMethod, state: AuthorizationObservation["state"], reason?: string) {
    this.#observations.set(method, {
      ...(reason === undefined ? {} : { reason }),
      state,
      verifiedAt: this.#now().toISOString(),
    })
  }

  #observeFailure(method: AuthorizationMethod, error: unknown) {
    if (error instanceof XiaoYunqueAuthenticationError) this.#observe(method, "expired", safeReason(error))
  }
}
