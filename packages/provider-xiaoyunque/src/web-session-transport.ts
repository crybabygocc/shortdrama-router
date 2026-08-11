import { randomUUID } from "node:crypto"
import type { ProviderVideoJobResult, VideoCreateRequest } from "@shortdrama-router/core"
import type { XiaoYunqueVideoModelDefinition } from "./catalog.js"
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
