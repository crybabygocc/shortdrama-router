import {
  RouterError,
  ShortDramaRouter,
  type AudioCreateRequest,
  type AudioJob,
  type AuthorizationMethod,
  type ImageCreateRequest,
  type ImageJob,
  type ProviderAuthorizationCompletion,
  type VideoCreateRequest,
} from "@shortdrama-router/core"

const maximumBodyBytes = 1024 * 1024
const maximumAudioBytes = 50 * 1024 * 1024

export interface LoadedAudio {
  readonly body: ArrayBuffer
  readonly contentType: string
}

export interface RouterHttpHandlerOptions {
  readonly audioPollIntervalMs?: number
  readonly audioTimeoutMs?: number
  readonly authorize?: (request: Request) => boolean | Promise<boolean>
  readonly imagePollIntervalMs?: number
  readonly imageTimeoutMs?: number
  readonly loadAudio?: (url: string, signal?: AbortSignal) => Promise<LoadedAudio>
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    headers: { "Cache-Control": "no-store" },
    status,
  })
}

function errorResponse(error: unknown) {
  if (error instanceof RouterError) {
    return json({ error: { code: error.code, message: error.message } }, error.status)
  }
  return json({ error: { code: "internal_error", message: "shortdrama-router request failed" } }, 500)
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
  const input = optionalJsonString(body.input, "input")
  const voice = optionalJsonString(body.voice, "voice")
  if (!model || !input || !voice) throw new RouterError("invalid_request", "model, input and voice are required", 400)
  if (body.response_format !== undefined && body.response_format !== "mp3") {
    throw new RouterError("unsupported_parameter", "only response_format=mp3 is supported", 400)
  }
  if (body.stream_format !== undefined && body.stream_format !== "audio") {
    throw new RouterError("unsupported_parameter", "only stream_format=audio is supported", 400)
  }
  if (body.speed !== undefined && typeof body.speed !== "number") {
    throw new RouterError("invalid_request", "speed must be a number", 400)
  }
  return {
    input,
    model,
    voice,
    ...(body.instructions === undefined ? {} : { instructions: optionalJsonString(body.instructions, "instructions")! }),
    ...(body.provider === undefined ? {} : { provider: optionalJsonString(body.provider, "provider")! }),
    ...(body.provider_options === undefined ? {} : { provider_options: body.provider_options as Readonly<Record<string, unknown>> }),
    ...(body.response_format === undefined ? {} : { response_format: "mp3" }),
    ...(body.speed === undefined ? {} : { speed: body.speed }),
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

async function waitForAudio(
  router: ShortDramaRouter,
  initial: AudioJob,
  options: RouterHttpHandlerOptions,
  signal?: AbortSignal,
) {
  const interval = options.audioPollIntervalMs ?? 2_000
  const timeout = options.audioTimeoutMs ?? 30 * 60_000
  if (!Number.isFinite(interval) || interval < 0 || !Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("audio polling configuration is invalid")
  }
  const deadline = Date.now() + timeout
  const sleep = options.sleep ?? defaultSleep
  let job = initial
  while (job.status === "queued" || job.status === "in_progress") {
    if (Date.now() >= deadline) throw new RouterError("generation_timeout", "audio generation timed out", 504)
    await sleep(interval, signal)
    job = await router.getAudio(job.id, signal)
  }
  if (job.status === "failed") {
    throw new RouterError(job.error?.code ?? "generation_failed", job.error?.message ?? "audio generation failed", 502)
  }
  if (job.status === "cancelled") throw new RouterError("generation_cancelled", "audio generation was cancelled", 409)
  if (!job.outputs?.length) throw new RouterError("provider_upstream_error", "audio generation completed without output", 502)
  return job
}

function approvedAudioUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new RouterError("audio_download_failed", "provider returned an invalid audio URL", 502)
  }
  const officialMediaHost = url.hostname === "jianying.com"
    || url.hostname.endsWith(".jianying.com")
    || url.hostname === "byteimg.com"
    || url.hostname.endsWith(".byteimg.com")
  if (url.protocol !== "https:" || !officialMediaHost || url.username || url.password || url.port || url.hash) {
    throw new RouterError("audio_download_failed", "provider returned an unapproved audio URL", 502)
  }
  return url
}

async function defaultLoadAudio(value: string, signal?: AbortSignal): Promise<LoadedAudio> {
  const response = await fetch(approvedAudioUrl(value), {
    headers: { Accept: "audio/*" },
    redirect: "error",
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok || !response.body) throw new RouterError("audio_download_failed", "provider audio download failed", 502)
  const upstreamContentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  const contentType = upstreamContentType?.startsWith("audio/")
    ? upstreamContentType
    : upstreamContentType === "application/octet-stream"
      ? "audio/mpeg"
      : undefined
  if (!contentType) throw new RouterError("audio_download_failed", "provider returned a non-audio response", 502)
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maximumAudioBytes) {
    throw new RouterError("audio_download_failed", "provider audio output is too large", 502)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumAudioBytes) {
      await reader.cancel()
      throw new RouterError("audio_download_failed", "provider audio output is too large", 502)
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { body: body.buffer, contentType }
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
        return json({ data: await router.listProviders({ probeAuthorization: probeRequested(url), signal: request.signal }) })
      }
      if (path[0] === "providers" && path[1]) {
        const provider = path[1]
        if (request.method === "GET" && path.length === 2) {
          return json(await router.getProvider(provider, { probeAuthorization: probeRequested(url), signal: request.signal }))
        }
        if (path[2] === "models" && path.length === 3 && request.method === "GET") {
          return json({ data: await router.listProviderModels(provider, request.signal) })
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
      }
      if (path.length === 2 && path[0] === "audio" && path[1] === "speech" && request.method === "POST") {
        const job = await waitForAudio(
          router,
          await router.createAudio(audioRequest(await boundedJson(request)), request.signal),
          options,
          request.signal,
        )
        const loaded = await (options.loadAudio ?? defaultLoadAudio)(job.outputs![0]!.url, request.signal)
        return new Response(loaded.body, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": loaded.contentType,
          },
          status: 200,
        })
      }
      if (path.length === 1 && path[0] === "images" && request.method === "POST") {
        const body = await boundedJson(request)
        return json(await router.createImage(imageRequest(body), request.signal), 202)
      }
      if (path.length === 2 && path[0] === "images" && path[1] === "generations" && request.method === "POST") {
        const body = await boundedJson(request)
        const job = await waitForImage(
          router,
          await router.createImage(withOpenAIImageSize(imageRequest(body)), request.signal),
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
      if (path.length === 1 && path[0] === "videos" && request.method === "POST") {
        return json(await router.createVideo(await videoRequest(request), request.signal), 202)
      }
      if (path.length === 2 && path[0] === "videos" && request.method === "GET") {
        return json(await router.getVideo(path[1]!, request.signal))
      }
      return json({ error: { code: "not_found", message: "route not found" } }, 404)
    } catch (error) {
      return errorResponse(error)
    }
  }
}
