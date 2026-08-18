import { createHash } from "node:crypto"
import type {
  AudioCreateRequest,
  ImageCreateRequest,
  ProviderAssetReference,
  ProviderAudioJobResult,
  ProviderImageJobResult,
  ProviderVideoJobResult,
  VideoCreateRequest,
  VideoInputReference,
  GenerationJobStatus,
} from "@shortdrama-router/core"
import type {
  XiaoYunqueAudioModelDefinition,
  XiaoYunqueImageModelDefinition,
  XiaoYunqueVideoModelDefinition,
} from "./catalog.js"
import { XiaoYunqueInputError } from "./errors.js"

export type XiaoYunqueCredential =
  | { readonly accessKey: string; readonly mode: "api_key" }
  | { readonly cookie: string; readonly mode: "browser_session" }

export interface XiaoYunqueTransport {
  createAudio?(
    model: XiaoYunqueAudioModelDefinition,
    request: AudioCreateRequest,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderAudioJobResult>
  createImage?(
    model: XiaoYunqueImageModelDefinition,
    request: ImageCreateRequest,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderImageJobResult>
  createVideo(
    model: XiaoYunqueVideoModelDefinition,
    request: VideoCreateRequest,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderVideoJobResult>
  getImage?(
    reference: Readonly<Record<string, unknown>>,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderImageJobResult>
  getAudio?(
    reference: Readonly<Record<string, unknown>>,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderAudioJobResult>
  getVideo(
    reference: Readonly<Record<string, unknown>>,
    credential: XiaoYunqueCredential,
    signal?: AbortSignal,
  ): Promise<ProviderVideoJobResult>
  probe(credential: XiaoYunqueCredential, signal?: AbortSignal): Promise<void>
}

export function credentialFingerprint(credential: XiaoYunqueCredential) {
  const secret = credential.mode === "api_key" ? credential.accessKey : credential.cookie
  return createHash("sha256").update(`${credential.mode}\0${secret}`, "utf8").digest("hex").slice(0, 24)
}

export function statusFromRunState(value: unknown): GenerationJobStatus {
  const state = typeof value === "string" && /^[0-9]$/u.test(value) ? Number(value) : value
  switch (state) {
    case 1:
      return "queued"
    case 2:
    case 7:
      return "in_progress"
    case 3:
      return "completed"
    case 5:
      return "cancelled"
    case 0:
    case 4:
    case 6:
    case 8:
    case 9:
      return "failed"
    default:
      return "in_progress"
  }
}

export function imageReferences(request: ImageCreateRequest) {
  if ((request.input_references?.length ?? 0) > 9) {
    throw new XiaoYunqueInputError("XiaoYunque accepts at most nine image references")
  }
  return (request.input_references ?? []).map(nativeAsset)
}

export function referenceGroups(request: VideoCreateRequest) {
  const images: ProviderAssetReference[] = []
  const videos: ProviderAssetReference[] = []
  const audios: ProviderAssetReference[] = []
  const add = (reference: VideoInputReference) => {
    if (reference.type === "image") images.push(reference.provider_asset)
    if (reference.type === "video") videos.push(reference.provider_asset)
    if (reference.type === "audio") audios.push(reference.provider_asset)
  }
  for (const reference of request.input_references ?? []) add(reference)
  let generateType: 1 | undefined
  if (request.frame_images?.first_frame) {
    generateType = 1
    images.push(request.frame_images.first_frame)
  }
  if (request.frame_images?.last_frame) images.push(request.frame_images.last_frame)
  if (images.length > 9) throw new Error("XiaoYunque accepts at most nine image references")
  if (videos.length > 3) throw new Error("XiaoYunque accepts at most three video references")
  if (audios.length > 3) throw new Error("XiaoYunque accepts at most three audio references")
  return { audios, generateType, images, videos }
}

export function nativeAsset(reference: ProviderAssetReference) {
  const requireAssetId = (value: string | undefined, label: string) => {
    if (value === undefined) return undefined
    if (
      value.length === 0
      || value !== value.trim()
      || value.length > 1_024
      || /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw new XiaoYunqueInputError(`${label} is invalid`)
    }
    return value
  }
  if (reference.provider !== undefined && reference.provider !== "xiaoyunque") {
    throw new XiaoYunqueInputError("asset reference belongs to another provider")
  }
  const pippitAssetId = requireAssetId(reference.id ?? reference.pippit_asset_id, "id")
  if (pippitAssetId === undefined) throw new XiaoYunqueInputError("asset reference id is required")
  const assetId = requireAssetId(reference.asset_id, "asset_id")
  return {
    ...(assetId === undefined ? {} : { asset_id: assetId }),
    pippit_asset_id: pippitAssetId,
  }
}

export function safeMediaUrl(value: unknown, allowLoopback: boolean) {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  const loopback = allowLoopback && url.protocol === "http:" && url.hostname === "127.0.0.1"
  if ((!loopback && url.protocol !== "https:") || url.username || url.password || url.hash) return undefined
  return url.toString()
}
