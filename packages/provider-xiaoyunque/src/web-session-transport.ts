import { randomUUID } from "node:crypto"
import type {
  AudioCreateRequest,
  ProviderAudioJobResult,
  ProviderVideoJobResult,
  VideoCreateRequest,
} from "@shortdrama-router/core"
import type { XiaoYunqueAudioModelDefinition, XiaoYunqueVideoModelDefinition } from "./catalog.js"
import { XiaoYunqueInputError } from "./errors.js"
import { asRecord, type FetchLike, requestEnvelope, requireString } from "./http-client.js"
import {
  credentialFingerprint,
  nativeAsset,
  referenceGroups,
  safeMediaUrl,
  statusFromRunState,
  type XiaoYunqueCredential,
  type XiaoYunqueTransport,
} from "./transport.js"

const identityPath = "/api/biz/v1/common/get_odin_user_info"
const workspacePath = "/api/web/v1/workspace/get_user_workspace"
const submitPath = "/api/biz/v1/agent/submit_run"
const queryPath = "/api/biz/v1/agent/get_thread"
const getRunPath = "/api/biz/v1/agent/get_run"

export interface WebSessionTransportOptions {
  readonly baseUrl: URL
  readonly fetch: FetchLike
}

function headers(credential: XiaoYunqueCredential, json = true) {
  if (credential.mode !== "browser_session") throw new Error("XiaoYunque Web session is required")
  return {
    Accept: "application/json",
    appid: "795647",
    appvr: "1.1.4",
    Cookie: credential.cookie,
    "entrance-from": "web",
    pf: "7",
    ...(json ? { "Content-Type": "application/json" } : {}),
  }
}

function runContext(runId: string) {
  const babi = {
    edit_type: "video_part",
    enter_from: "web",
    generate_id: runId,
    scene_lv1: "ai_agent",
    scene_lv2: "front_tool",
    section_id: runId,
    tab_name: "canvas",
    tool_id: "pippit_novel_video_part_agent",
  }
  const { generate_id: _generateId, ...query } = babi
  return {
    body: JSON.stringify({
      babi_param: babi,
      client_extra: {
        edit_type: "video_part",
        entrance_from: "web",
        position: "canvas",
        run_source: "video_part",
        tab_name: "canvas",
        target: "video",
      },
    }),
    query: JSON.stringify(query),
  }
}

function audioNumberOption(
  options: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = options[key]
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new XiaoYunqueInputError(`${key} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function audioConfig(request: AudioCreateRequest) {
  const options = request.provider_options ?? {}
  const sampleRate = audioNumberOption(options, "sample_rate", 44_100, 8_000, 48_000)
  if (![8_000, 16_000, 24_000, 32_000, 44_100, 48_000].includes(sampleRate)) {
    throw new XiaoYunqueInputError("sample_rate is not supported by Seed Audio")
  }
  return {
    format: request.format ?? "mp3",
    loudness_rate: audioNumberOption(options, "loudness_rate", 0, -50, 100),
    pitch_rate: audioNumberOption(options, "pitch_rate", 0, -12, 12),
    sample_rate: sampleRate,
    speech_rate: audioNumberOption(options, "speech_rate", 0, -50, 100),
  }
}

function audioReferences(request: AudioCreateRequest) {
  return (request.input_references ?? []).map(reference => ({
    ...nativeAsset(reference.provider_asset),
    type: reference.type,
  }))
}

function seedAudioPrompt(request: AudioCreateRequest) {
  const audioCount = (request.input_references ?? []).filter(reference => reference.type === "audio").length
  const mentions = Array.from({ length: audioCount }, (_, index) => `@音频${index + 1}`)
    .filter(mention => !request.prompt.includes(mention))
  return mentions.length === 0 ? request.prompt : `${mentions.join(" ")} ${request.prompt}`
}

function audioRunExtra(runId: string) {
  return JSON.stringify({
    babi_param: {
      edit_type: "novel",
      enter_from: "web",
      generate_id: `canvas_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      scene_lv1: "ai_agent",
      scene_lv2: "front_tool",
      section_id: runId,
      tab_name: "canvas",
      tool_id: "novel_canvas",
    },
    client_extra: {
      edit_type: "audio_generation",
      entrance_from: "web",
      gui_name: "canvas_raw_audio_generation",
      placement_name: "canvas",
      position: "canvas",
      run_source: "canvas_raw_audio_generation",
      tab_name: "canvas",
      target: "audio",
    },
  })
}

function audioOutputs(entries: unknown, allowLoopback: boolean) {
  if (!Array.isArray(entries)) return []
  const urls = new Map<string, string | undefined>()
  const containers = entries.flatMap(entryValue => {
    const entry = entryValue && typeof entryValue === "object" ? entryValue as Record<string, unknown> : undefined
    if (!entry) return []
    return [entry, entry.message, entry.artifact, entry.detail]
      .filter(value => value && typeof value === "object") as Record<string, unknown>[]
  })
  for (const container of containers) {
    if (!Array.isArray(container.content)) continue
    for (const partValue of container.content) {
      const part = partValue && typeof partValue === "object" ? partValue as Record<string, unknown> : undefined
      if (part?.sub_type !== "biz/x_data_audio" && part?.sub_type !== "biz/x_data_novel_raw_audio_gen") continue
      let data: Record<string, unknown> | undefined
      try {
        data = typeof part.data === "string" ? JSON.parse(part.data) as Record<string, unknown> : part.data as Record<string, unknown>
      } catch {
        continue
      }
      const audioValue = data?.audio ?? data?.audio_info ?? data
      const audio = audioValue && typeof audioValue === "object" ? audioValue as Record<string, unknown> : undefined
      if (!audio) continue
      const url = safeMediaUrl(
        audio.download_url ?? audio.url ?? audio.audio_url ?? audio.preview_url ?? audio.play_url,
        allowLoopback,
      )
      if (!url) continue
      const mime = typeof audio.mime === "string"
        ? audio.mime
        : typeof audio.mime_type === "string"
          ? audio.mime_type
          : undefined
      urls.set(url, mime?.startsWith("audio/") ? mime : undefined)
    }
  }
  return [...urls].map(([url, contentType]) => ({
    ...(contentType === undefined ? {} : { content_type: contentType }),
    url,
  }))
}

function artifactOutputs(entries: unknown, allowLoopback: boolean) {
  if (!Array.isArray(entries)) return []
  const urls = new Set<string>()
  for (const entryValue of entries) {
    const entry = entryValue && typeof entryValue === "object" ? entryValue as Record<string, unknown> : undefined
    const container = entry?.artifact && typeof entry.artifact === "object"
      ? entry.artifact as Record<string, unknown>
      : entry?.message && typeof entry.message === "object"
        ? entry.message as Record<string, unknown>
        : undefined
    if (!Array.isArray(container?.content)) continue
    for (const partValue of container.content) {
      const part = partValue && typeof partValue === "object" ? partValue as Record<string, unknown> : undefined
      if (part?.sub_type !== "biz/x_data_video") continue
      let data: Record<string, unknown> | undefined
      try {
        data = typeof part.data === "string" ? JSON.parse(part.data) as Record<string, unknown> : part.data as Record<string, unknown>
      } catch {
        continue
      }
      const video = data?.video && typeof data.video === "object" ? data.video as Record<string, unknown> : undefined
      const scenes = video?.scene_urls && typeof video.scene_urls === "object" ? video.scene_urls as Record<string, unknown> : undefined
      const url = safeMediaUrl(scenes?.download ?? video?.url ?? video?.download_url, allowLoopback)
      if (url) urls.add(url)
    }
  }
  return [...urls].map(url => ({ content_type: "video/mp4", url }))
}

export class XiaoYunqueWebSessionTransport implements XiaoYunqueTransport {
  readonly #allowLoopback: boolean
  readonly #baseUrl: URL
  readonly #fetch: FetchLike

  constructor(options: WebSessionTransportOptions) {
    this.#baseUrl = options.baseUrl
    this.#fetch = options.fetch
    this.#allowLoopback = this.#baseUrl.protocol === "http:" && this.#baseUrl.hostname === "127.0.0.1"
  }

  async probe(credential: XiaoYunqueCredential, signal?: AbortSignal) {
    await requestEnvelope(this.#fetch, new URL(identityPath, this.#baseUrl), {
      body: "{}",
      headers: headers(credential),
      method: "POST",
    }, signal)
  }

  async createAudio(
    model: XiaoYunqueAudioModelDefinition,
    request: AudioCreateRequest,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderAudioJobResult> {
    const runId = randomUUID()
    const threadId = randomUUID()
    const references = audioReferences(request)
    const result = await requestEnvelope(this.#fetch, new URL(submitPath, this.#baseUrl), {
      body: JSON.stringify({
        agent_name: "pippit_novel_agent_cn_v2",
        entrance_from: "web",
        message: {
          content: [{
            data: JSON.stringify({
              audio_config: audioConfig(request),
              model: model.upstream_model,
              prompt: seedAudioPrompt(request),
              ...(references.length === 0 ? {} : { references }),
              text: "",
            }),
            sub_type: "biz/x_data_novel_raw_audio_gen",
            type: "data",
          }],
          created_at: Date.now(),
          message_id: randomUUID(),
          role: "user",
          run_id: runId,
          thread_id: threadId,
        },
        request_id: randomUUID(),
        run_extra: audioRunExtra(runId),
      }),
      headers: headers(credential),
      method: "POST",
    }, signal)
    const run = result.run && typeof result.run === "object" ? result.run as Record<string, unknown> : undefined
    return {
      reference: {
        credential_fingerprint: credentialFingerprint(credential),
        run_id: typeof run?.run_id === "string" ? run.run_id : runId,
        thread_id: typeof run?.thread_id === "string" ? run.thread_id : threadId,
        transport: "browser_session",
      },
      status: run?.state === undefined ? "queued" : statusFromRunState(run.state),
    }
  }

  async getAudio(
    reference: Readonly<Record<string, unknown>>,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderAudioJobResult> {
    const runId = requireString(reference.run_id, "XiaoYunque run id")
    const threadId = requireString(reference.thread_id, "XiaoYunque thread id")
    const result = await requestEnvelope(this.#fetch, new URL(getRunPath, this.#baseUrl), {
      body: JSON.stringify({ run_id: runId, scopes: ["entry_list"], thread_id: threadId }),
      headers: headers(credential),
      method: "POST",
    }, signal)
    const run = result.run && typeof result.run === "object" ? result.run as Record<string, unknown> : undefined
    if (!run) return { reference, status: "queued" }
    const status = statusFromRunState(run.state)
    if (status === "failed") {
      return { error: { code: "generation_failed", message: "XiaoYunque audio generation failed" }, reference, status }
    }
    const outputs = audioOutputs(run.entry_list ?? run.message_list, this.#allowLoopback)
    return {
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
    const identity = await requestEnvelope(this.#fetch, new URL(identityPath, this.#baseUrl), {
      body: "{}",
      headers: headers(credential),
      method: "POST",
    }, signal)
    const consumerUid = requireString(identity.user_id, "XiaoYunque user id")
    const workspace = await requestEnvelope(this.#fetch, new URL(workspacePath, this.#baseUrl), {
      body: JSON.stringify({ uid: consumerUid }),
      headers: headers(credential),
      method: "POST",
    }, signal)
    const workspaceId = requireString(workspace.workspace_id, "XiaoYunque workspace id")
    const spaceId = requireString(workspace.space_id, "XiaoYunque space id")
    const references = referenceGroups(request)
    const runId = randomUUID()
    const threadId = randomUUID()
    const context = runContext(runId)
    await requestEnvelope(this.#fetch, new URL(`${submitPath}?${new URLSearchParams({ babi_param: context.query })}`, this.#baseUrl), {
      body: JSON.stringify({
        agent_name: "pippit_novel_video_part_agent",
        entrance_from: "web",
        message: {
          content: [{
            data: JSON.stringify({
              param: JSON.stringify({
                audios: references.audios.map(nativeAsset),
                duration_sec: request.duration ?? 5,
                ...(references.generateType === undefined ? {} : { generate_type: references.generateType }),
                images: references.images.map(nativeAsset),
                language: "zh",
                model: model.upstream_model,
                prompt: request.prompt,
                ratio: request.aspect_ratio ?? "16:9",
                resolution: request.resolution ?? "720p",
                ...(request.seed === undefined ? {} : { seed: request.seed }),
                videos: references.videos.map(nativeAsset),
              }),
              tool_name: "biz/x_tool_name_video_part",
            }),
            hidden: false,
            is_thought: false,
            sub_type: "biz/x_data_direct_tool_call_req",
            type: "data",
          }],
          created_at: Date.now(),
          message_id: "",
          role: "user",
          run_id: runId,
          thread_id: threadId,
        },
        run_extra: context.body,
        user_info: {
          app_id: "795647",
          consumer_uid: consumerUid,
          space_id: spaceId,
          workspace_id: workspaceId,
        },
      }),
      headers: headers(credential),
      method: "POST",
    }, signal)
    return {
      reference: {
        credential_fingerprint: credentialFingerprint(credential),
        run_id: runId,
        thread_id: threadId,
        transport: "browser_session",
      },
      status: "queued",
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
      body: JSON.stringify({ run_id: runId, scopes: ["run_list.entry_list"], thread_id: threadId }),
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
    const outputs = artifactOutputs(run.entry_list, this.#allowLoopback)
    return {
      ...(status === "failed" ? { error: { code: "generation_failed", message: "XiaoYunque video generation failed" } } : {}),
      ...(outputs.length === 0 ? {} : { outputs }),
      reference,
      status,
    }
  }
}
