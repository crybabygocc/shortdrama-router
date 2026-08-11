import type {
  ImageCreateRequest,
  ProviderImageJobResult,
  ProviderVideoJobResult,
  VideoCreateRequest,
} from "@shortdrama-router/core"
import type {
  XiaoYunqueImageModelDefinition,
  XiaoYunqueVideoModelDefinition,
} from "./catalog.js"
import { asRecord, type FetchLike, requestEnvelope, requireString } from "./http-client.js"
import {
  credentialFingerprint,
  imageReferences,
  nativeAsset,
  referenceGroups,
  safeMediaUrl,
  statusFromRunState,
  type XiaoYunqueCredential,
  type XiaoYunqueTransport,
} from "./transport.js"

const submitPath = "/api/biz/v1/skill/submit_run"
const queryPath = "/api/biz/v1/agent/query_generate_video_result"
const probePath = "/api/biz/v1/skill/get_thread"

const imageRatioIds: Readonly<Record<string, number>> = {
  auto: 0,
  "16:9": 2,
  "21:9": 13,
  "9:16": 3,
  "4:3": 4,
  "3:4": 5,
  "1:1": 6,
}

export interface AccessKeyTransportOptions {
  readonly baseUrl: URL
  readonly fetch: FetchLike
}

function headers(credential: XiaoYunqueCredential) {
  if (credential.mode !== "api_key") throw new Error("XiaoYunque Access Key credential is required")
  return {
    Accept: "application/json",
    Authorization: `Bearer ${credential.accessKey}`,
    "Content-Type": "application/json",
  }
}

function outputUrls(value: unknown, allowLoopback: boolean) {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const url = safeMediaUrl(item, allowLoopback)
    return url === undefined ? [] : [{ content_type: "video/mp4", url }]
  })
}

function imageOutputUrls(entries: unknown, allowLoopback: boolean) {
  if (!Array.isArray(entries)) return []
  const urls = new Set<string>()
  for (const entryValue of entries) {
    const entry = entryValue && typeof entryValue === "object" ? entryValue as Record<string, unknown> : undefined
    const artifact = entry?.artifact && typeof entry.artifact === "object"
      ? entry.artifact as Record<string, unknown>
      : undefined
    if (!Array.isArray(artifact?.content)) continue
    for (const partValue of artifact.content) {
      const part = partValue && typeof partValue === "object" ? partValue as Record<string, unknown> : undefined
      if (part?.sub_type !== "biz/x_data_image") continue
      let data: Record<string, unknown> | undefined
      try {
        data = typeof part.data === "string" ? JSON.parse(part.data) as Record<string, unknown> : part.data as Record<string, unknown>
      } catch {
        continue
      }
      const image = data?.image && typeof data.image === "object" ? data.image as Record<string, unknown> : undefined
      const url = safeMediaUrl(image?.url ?? image?.download_url, allowLoopback)
      if (url) urls.add(url)
    }
  }
  return [...urls].map(url => ({ url }))
}

export class XiaoYunqueAccessKeyTransport implements XiaoYunqueTransport {
  readonly #allowLoopback: boolean
  readonly #baseUrl: URL
  readonly #fetch: FetchLike

  constructor(options: AccessKeyTransportOptions) {
    this.#baseUrl = options.baseUrl
    this.#fetch = options.fetch
    this.#allowLoopback = this.#baseUrl.protocol === "http:" && this.#baseUrl.hostname === "127.0.0.1"
  }

  async probe(credential: XiaoYunqueCredential, signal?: AbortSignal) {
    const id = crypto.randomUUID()
    await requestEnvelope(this.#fetch, new URL(probePath, this.#baseUrl), {
      body: JSON.stringify({ limit: 1, run_id: id, scopes: ["run_list.entry_list"], thread_id: id }),
      headers: headers(credential),
      method: "POST",
    }, signal, [5])
  }

  async createImage(
    model: XiaoYunqueImageModelDefinition,
    request: ImageCreateRequest,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderImageJobResult> {
    const ratio = request.aspect_ratio === undefined ? undefined : imageRatioIds[request.aspect_ratio]
    const result = await requestEnvelope(this.#fetch, new URL(submitPath, this.#baseUrl), {
      body: JSON.stringify({
        agent_name: "pippit_nest_agent",
        ...(request.input_references?.length ? { asset_ids: imageReferences(request).map(reference => reference.pippit_asset_id) } : {}),
        general_agent_settings: {
          image_model: model.upstream_model,
          ...(ratio === undefined ? {} : { ratio }),
          ...(request.resolution === undefined ? {} : { resolution: request.resolution.toUpperCase() }),
          ...(request.n === undefined ? {} : { generate_image_count: request.n }),
        },
        message: request.prompt,
      }),
      headers: headers(credential),
      method: "POST",
    }, signal)
    const run = asRecord(result.run, "XiaoYunque run")
    return {
      reference: {
        credential_fingerprint: credentialFingerprint(credential),
        run_id: requireString(run.run_id, "XiaoYunque run id"),
        thread_id: requireString(run.thread_id, "XiaoYunque thread id"),
        transport: "api_key",
      },
      status: run.state === undefined ? "queued" : statusFromRunState(run.state),
    }
  }

  async getImage(
    reference: Readonly<Record<string, unknown>>,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderImageJobResult> {
    const runId = requireString(reference.run_id, "XiaoYunque run id")
    const threadId = requireString(reference.thread_id, "XiaoYunque thread id")
    const result = await requestEnvelope(this.#fetch, new URL(probePath, this.#baseUrl), {
      body: JSON.stringify({ run_id: runId, thread_id: threadId }),
      headers: headers(credential),
      method: "POST",
    }, signal)
    const thread = asRecord(result.thread, "XiaoYunque thread")
    const runs = Array.isArray(thread.run_list) ? thread.run_list : []
    const run = runs
      .filter(item => item && typeof item === "object")
      .map(item => item as Record<string, unknown>)
      .find(item => item.run_id === runId)
    if (!run) return { reference, status: "queued" }
    const status = statusFromRunState(run.state)
    const outputs = imageOutputUrls(run.entry_list, this.#allowLoopback)
    return {
      ...(status === "failed" ? { error: { code: "generation_failed", message: "XiaoYunque image generation failed" } } : {}),
      ...(outputs.length === 0 ? {} : { outputs }),
      reference,
      status,
    }
  }

  async createVideo(
    model: XiaoYunqueVideoModelDefinition,
    request: VideoCreateRequest,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderVideoJobResult> {
    const references = referenceGroups(request)
    const assetIds = [...new Set([
      ...references.images,
      ...references.videos,
      ...references.audios,
    ].map(reference => reference.pippit_asset_id))]
    const result = await requestEnvelope(this.#fetch, new URL(submitPath, this.#baseUrl), {
      body: JSON.stringify({
        agent_name: "pippit_video_part_agent",
        asset_ids: assetIds,
        message: request.prompt,
        video_part_tool_param: {
          audios: references.audios.map(nativeAsset),
          duration_sec: request.duration ?? 5,
          ...(references.generateType === undefined ? {} : { generate_type: references.generateType }),
          images: references.images.map(nativeAsset),
          ...(model.upstream_model === "Seedance_2.5" ? { imitation_videos: [], language: "zh", task_type: "reference" } : {}),
          model: model.upstream_model,
          prompt: request.prompt,
          ratio: request.aspect_ratio ?? "16:9",
          resolution: request.resolution ?? (model.capabilities.resolutions?.includes("720p") ? "720p" : model.capabilities.resolutions?.[0]),
          ...(request.seed === undefined ? {} : { seed: request.seed }),
          videos: references.videos.map(nativeAsset),
        },
      }),
      headers: headers(credential),
      method: "POST",
    }, signal)
    const run = asRecord(result.run, "XiaoYunque run")
    const runId = requireString(run.run_id, "XiaoYunque run id")
    const threadId = requireString(run.thread_id, "XiaoYunque thread id")
    return {
      reference: {
        credential_fingerprint: credentialFingerprint(credential),
        run_id: runId,
        thread_id: threadId,
        transport: "api_key",
      },
      status: statusFromRunState(run.state),
    }
  }

  async getVideo(
    reference: Readonly<Record<string, unknown>>,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderVideoJobResult> {
    const runId = requireString(reference.run_id, "XiaoYunque run id")
    const threadId = requireString(reference.thread_id, "XiaoYunque thread id")
    const result = await requestEnvelope(this.#fetch, new URL(queryPath, this.#baseUrl), {
      body: JSON.stringify({ run_id: runId, thread_id: threadId }),
      headers: headers(credential),
      method: "POST",
    }, signal)
    const status = statusFromRunState(result.run_state)
    const outputs = outputUrls(result.video_urls, this.#allowLoopback)
    return {
      ...(status === "failed" ? { error: { code: "generation_failed", message: "XiaoYunque video generation failed" } } : {}),
      ...(outputs.length === 0 ? {} : { outputs }),
      reference,
      status,
    }
  }
}
