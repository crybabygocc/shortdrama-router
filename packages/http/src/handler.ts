import {
  RouterError,
  ShortDramaRouter,
  type AudioCreateRequest,
  type AuthorizationMethod,
  type ImageCreateRequest,
  type ImageJob,
  type ProviderAuthorizationCompletion,
  type VideoCreateRequest,
} from "@shortdrama-router/core"

const maximumBodyBytes = 1024 * 1024
export interface RouterHttpHandlerOptions {
  readonly authorize?: (request: Request) => boolean | Promise<boolean>
  readonly imagePollIntervalMs?: number
  readonly imageTimeoutMs?: number
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(value, {
    headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) },
    status,
  })
}

function errorResponse(error: unknown) {
  if (error instanceof RouterError) {
    return json({
      error: {
        category: error.category,
        code: error.code,
        message: error.message,
        ...(error.provider ? { provider: error.provider } : {}),
        ...(error.providerCode ? { provider_code: error.providerCode } : {}),
        ...(error.retryAfterSeconds !== undefined ? { retry_after_seconds: error.retryAfterSeconds } : {}),
        retryable: error.retryable,
      },
    }, error.status, error.retryAfterSeconds === undefined ? {} : { "Retry-After": String(error.retryAfterSeconds) })
  }
  return json({
    error: {
      category: "internal",
      code: "internal_error",
      message: "shortdrama-router request failed",
      retryable: false,
    },
  }, 500)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouterError("invalid_request", "request body must be an object", 400)
  }
  return value as Record<string, unknown>
}

async function boundedJson(request: Request) {
  const contentLength = request.headers.get("content-length")
  if (contentLength !== null && Number(contentLength) > maximumBodyBytes) {
    throw new RouterError("request_too_large", "request body is too large", 413)
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBodyBytes) {
    throw new RouterError("invalid_request", "request body is empty or too large", bytes.byteLength > maximumBodyBytes ? 413 : 400)
  }
  try {
    return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown)
  } catch (error) {
    if (error instanceof RouterError) throw error
    throw new RouterError("invalid_json", "request body is not valid JSON", 400)
  }
}

function defaultSleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function optionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: FormDataEntryValue | null) {
  const string = optionalString(value)
  if (string === undefined) return undefined
  const number = Number(string)
  if (!Number.isFinite(number)) throw new RouterError("invalid_request", "numeric form field is invalid", 400)
  return number
}

async function videoRequest(request: Request): Promise<VideoCreateRequest> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData()
    const model = optionalString(form.get("model"))
    const prompt = optionalString(form.get("prompt"))
    if (!model || !prompt) throw new RouterError("invalid_request", "model and prompt are required", 400)
    const provider = optionalString(form.get("provider"))
    const duration = optionalNumber(form.get("seconds")) ?? optionalNumber(form.get("duration"))
    const aspectRatio = optionalString(form.get("aspect_ratio"))
    const resolution = optionalString(form.get("resolution"))
    return {
      model,
      prompt,
      ...(provider === undefined ? {} : { provider }),
      ...(duration === undefined ? {} : { duration }),
      ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
      ...(resolution === undefined ? {} : { resolution }),
    }
  }
  const body = await boundedJson(request)
  if (typeof body.model !== "string" || typeof body.prompt !== "string") {
    throw new RouterError("invalid_request", "model and prompt are required", 400)
  }
  return body as unknown as VideoCreateRequest
}

function optionalJsonString(value: unknown, label: string) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RouterError("invalid_request", `${label} must be a non-empty string`, 400)
  }
  return value.trim()
}

function imageRequest(body: Record<string, unknown>): ImageCreateRequest {
  const model = optionalJsonString(body.model, "model")
  const prompt = optionalJsonString(body.prompt, "prompt")
  if (!model || !prompt) throw new RouterError("invalid_request", "model and prompt are required", 400)
  if (body.response_format !== undefined && body.response_format !== "url") {
    throw new RouterError("unsupported_parameter", "only response_format=url is supported", 400)
  }
  return {
    model,
    prompt,
    ...(body.idempotency_key === undefined ? {} : { idempotency_key: optionalJsonString(body.idempotency_key, "idempotency_key")! }),
    ...(body.provider === undefined ? {} : { provider: optionalJsonString(body.provider, "provider")! }),
    ...(body.n === undefined ? {} : { n: body.n as number }),
    ...(body.size === undefined ? {} : { size: optionalJsonString(body.size, "size")! }),
    ...(body.aspect_ratio === undefined ? {} : { aspect_ratio: optionalJsonString(body.aspect_ratio, "aspect_ratio")! }),
    ...(body.resolution === undefined ? {} : { resolution: optionalJsonString(body.resolution, "resolution")! }),
    ...(body.input_references === undefined ? {} : {
      input_references: body.input_references as NonNullable<ImageCreateRequest["input_references"]>,
    }),
    ...(body.provider_options === undefined ? {} : { provider_options: body.provider_options as Readonly<Record<string, unknown>> }),
  }
}

function audioRequest(body: Record<string, unknown>): AudioCreateRequest {
  const model = optionalJsonString(body.model, "model")
  const prompt = optionalJsonString(body.prompt, "prompt")
  if (!model || !prompt) throw new RouterError("invalid_request", "model and prompt are required", 400)
  return {
    model,
    prompt,
    ...(body.idempotency_key === undefined ? {} : { idempotency_key: optionalJsonString(body.idempotency_key, "idempotency_key")! }),
    ...(body.format === undefined ? {} : { format: optionalJsonString(body.format, "format")! }),
    ...(body.input_references === undefined ? {} : {
      input_references: body.input_references as NonNullable<AudioCreateRequest["input_references"]>,
    }),
    ...(body.provider === undefined ? {} : { provider: optionalJsonString(body.provider, "provider")! }),
    ...(body.provider_options === undefined ? {} : { provider_options: body.provider_options as Readonly<Record<string, unknown>> }),
  }
}

function withOpenAIImageSize(request: ImageCreateRequest): ImageCreateRequest {
  if (!request.size || request.size === "auto" || request.aspect_ratio) return request
  const aspectRatio = request.size === "1024x1024" || request.size === "512x512" || request.size === "256x256"
    ? "1:1"
    : request.size === "1792x1024"
      ? "16:9"
      : request.size === "1024x1792"
        ? "9:16"
        : undefined
  if (!aspectRatio) {
    throw new RouterError("unsupported_parameter", `size ${request.size} cannot be mapped to this provider`, 400)
  }
  return { ...request, aspect_ratio: aspectRatio }
}

async function waitForImage(
  router: ShortDramaRouter,
  initial: ImageJob,
  options: RouterHttpHandlerOptions,
  signal?: AbortSignal,
) {
  const interval = options.imagePollIntervalMs ?? 2_000
  const timeout = options.imageTimeoutMs ?? 30 * 60_000
  if (!Number.isFinite(interval) || interval < 0 || !Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("image polling configuration is invalid")
  }
  const deadline = Date.now() + timeout
  const sleep = options.sleep ?? defaultSleep
  let job = initial
  while (job.status === "queued" || job.status === "in_progress") {
    if (Date.now() >= deadline) throw new RouterError("generation_timeout", "image generation timed out", 504)
    await sleep(interval, signal)
    job = await router.getImage(job.id, signal)
  }
  if (job.status === "failed") {
    throw new RouterError(job.error?.code ?? "generation_failed", job.error?.message ?? "image generation failed", 502)
  }
  if (job.status === "cancelled") throw new RouterError("generation_cancelled", "image generation was cancelled", 409)
  if (!job.outputs?.length) throw new RouterError("provider_upstream_error", "image generation completed without output", 502)
  return job
}

function segments(url: URL) {
  const values = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  if (values[0] === "api" && values[1] === "v1") return values.slice(2)
  if (values[0] === "v1") return values.slice(1)
  return values
}

function probeRequested(url: URL) {
  return url.searchParams.get("probe") === "true" || url.searchParams.get("probe") === "1"
}

function withIdempotency<T extends AudioCreateRequest | ImageCreateRequest | VideoCreateRequest>(
  request: Request,
  body: T,
): T {
  const key = request.headers.get("idempotency-key") ?? undefined
  if (key === undefined) return body
  if (body.idempotency_key !== undefined && body.idempotency_key !== key) {
    throw new RouterError("idempotency_key_mismatch", "body and header idempotency keys do not match", 400, {
      category: "invalid_request",
      retryable: false,
    })
  }
  return { ...body, idempotency_key: key }
}

export function createRouterHttpHandler(
  router: ShortDramaRouter,
  options: RouterHttpHandlerOptions = {},
) {
  return async function handle(request: Request): Promise<Response> {
    try {
      if (options.authorize && !await options.authorize(request)) {
        return json({ error: { code: "unauthorized", message: "invalid router authorization" } }, 401)
      }
      const url = new URL(request.url)
      const path = segments(url)
      if (request.method === "GET" && path.length === 1 && path[0] === "health") {
        return json({ status: "ok" })
      }
      if (request.method === "GET" && path.length === 1 && path[0] === "providers") {
        const probe = probeRequested(url)
        return json({ data: await router.listProviders({
          probeAuthorization: probe,
          probeConfiguration: probe,
          probeDependencies: probe,
          signal: request.signal,
        }) })
      }
      if (path[0] === "providers" && path[1]) {
        const provider = path[1]
        if (request.method === "GET" && path.length === 2) {
          const probe = probeRequested(url)
          return json(await router.getProvider(provider, {
            probeAuthorization: probe,
            probeConfiguration: probe,
            probeDependencies: probe,
            signal: request.signal,
          }))
        }
        if (path[2] === "models" && path.length === 3 && request.method === "GET") {
          return json({ data: await router.listProviderModels(provider, request.signal, probeRequested(url)) })
        }
        if (path[2] === "authorization" && path.length === 3) {
          if (request.method === "GET") {
            return json(await router.getProviderAuthorization(provider, { probe: probeRequested(url), signal: request.signal }))
          }
          if (request.method === "POST") {
            const body = await boundedJson(request)
            if (typeof body.method !== "string") throw new RouterError("invalid_request", "authorization method is required", 400)
            return json(await router.beginProviderAuthorization(provider, body.method as AuthorizationMethod, request.signal), 201)
          }
          if (request.method === "PUT") {
            const body = await boundedJson(request)
            return json(await router.completeProviderAuthorization(provider, body as unknown as ProviderAuthorizationCompletion, request.signal))
          }
          if (request.method === "DELETE") {
            await router.clearProviderAuthorization(provider, request.signal)
            return new Response(null, { status: 204 })
          }
        }
        if (path[2] === "authorizations" && path.length === 3 && request.method === "GET") {
          return json(await router.getProviderAuthorizations(provider, { probe: probeRequested(url), signal: request.signal }))
        }
        if (path[2] === "authorizations" && path[3] && path.length === 4 && request.method === "DELETE") {
          await router.clearProviderAuthorizationMethod(provider, path[3] as AuthorizationMethod, request.signal)
          return new Response(null, { status: 204 })
        }
        if (path[2] === "authorization-requests" && path[3] && path.length === 4 && request.method === "DELETE") {
          await router.cancelProviderAuthorization(provider, path[3], request.signal)
          return new Response(null, { status: 204 })
        }
        if (path[2] === "configuration" && path.length === 3) {
          if (request.method === "GET") {
            return json(await router.getProviderConfiguration(provider, { probe: probeRequested(url), signal: request.signal }))
          }
          if (request.method === "PUT") {
            const body = await boundedJson(request)
            if (typeof body.resource_id !== "string" || typeof body.resource_type !== "string") {
              throw new RouterError("invalid_request", "resource_id and resource_type are required", 400)
            }
            return json(await router.configureProvider(provider, {
              resource_id: body.resource_id,
              resource_type: body.resource_type,
            }, request.signal))
          }
          if (request.method === "DELETE") {
            await router.clearProviderConfiguration(provider, request.signal)
            return new Response(null, { status: 204 })
          }
        }
        if (path[2] === "resources" && path.length === 3 && request.method === "GET") {
          return json({ data: await router.listProviderResources(provider, url.searchParams.get("type") ?? undefined, request.signal) })
        }
      }
      if (path.length === 1 && path[0] === "audio" && request.method === "POST") {
        return json(await router.createAudio(withIdempotency(request, audioRequest(await boundedJson(request))), request.signal), 202)
      }
      if (path.length === 2 && path[0] === "audio" && request.method === "GET") {
        return json(await router.getAudio(path[1]!, request.signal))
      }
      if (path.length === 2 && path[0] === "audio" && request.method === "DELETE") {
        return json(await router.cancelAudio(path[1]!, request.signal))
      }
      if (path.length === 1 && path[0] === "images" && request.method === "POST") {
        const body = await boundedJson(request)
        return json(await router.createImage(withIdempotency(request, imageRequest(body)), request.signal), 202)
      }
      if (path.length === 2 && path[0] === "images" && path[1] === "generations" && request.method === "POST") {
        const body = await boundedJson(request)
        const job = await waitForImage(
          router,
          await router.createImage(withIdempotency(request, withOpenAIImageSize(imageRequest(body))), request.signal),
          options,
          request.signal,
        )
        return json({
          created: Math.floor(new Date(job.created_at).getTime() / 1_000),
          data: job.outputs!.map(output => ({ url: output.url })),
        })
      }
      if (path.length === 2 && path[0] === "images" && request.method === "GET") {
        return json(await router.getImage(path[1]!, request.signal))
      }
      if (path.length === 2 && path[0] === "images" && request.method === "DELETE") {
        return json(await router.cancelImage(path[1]!, request.signal))
      }
      if (path.length === 1 && path[0] === "videos" && request.method === "POST") {
        return json(await router.createVideo(withIdempotency(request, await videoRequest(request)), request.signal), 202)
      }
      if (path.length === 2 && path[0] === "videos" && request.method === "GET") {
        return json(await router.getVideo(path[1]!, request.signal))
      }
      if (path.length === 2 && path[0] === "videos" && request.method === "DELETE") {
        return json(await router.cancelVideo(path[1]!, request.signal))
      }
      return json({ error: { code: "not_found", message: "route not found" } }, 404)
    } catch (error) {
      return errorResponse(error)
    }
  }
}
