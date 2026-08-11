import type {
  ImageCreateRequest,
  ProviderModel,
  VideoCreateRequest,
} from "@shortdrama-router/core"
import { XiaoYunqueInputError } from "./errors.js"

export interface XiaoYunqueImageModelDefinition extends ProviderModel {
  readonly kind: "image"
  readonly upstream_model: string
}

export interface XiaoYunqueVideoModelDefinition extends ProviderModel {
  readonly kind: "video"
  readonly upstream_model: string
}

const imageAspectRatios = ["auto", "16:9", "21:9", "9:16", "4:3", "3:4", "1:1"] as const

const imageModel = (
  id: string,
  name: string,
  upstreamModel: string,
  options: { readonly resolutions?: readonly string[] } = {},
): XiaoYunqueImageModelDefinition => ({
  capabilities: {
    aspect_ratios: imageAspectRatios,
    reference_image: true,
    ...(options.resolutions === undefined ? {} : { resolutions: options.resolutions }),
  },
  description: `${name} image generation through XiaoYunque Nest Agent.`,
  id: `xiaoyunque/${id}`,
  kind: "image",
  name,
  provider: "xiaoyunque",
  upstream_model: upstreamModel,
})

export const XIAOYUNQUE_IMAGE_MODELS: readonly XiaoYunqueImageModelDefinition[] = [
  imageModel("seedream-5.0-pro", "Seedream 5.0 Pro", "seedream_5.0_pro", { resolutions: ["1K", "2K", "4K"] }),
  imageModel("seedream-5.0", "Seedream 5.0", "seedream_5.0"),
  imageModel("seedream-4.5", "Seedream 4.5", "seedream_4.5"),
  imageModel("seedream-4.3", "Seedream 4.3", "seedream_4.3"),
  imageModel("seedream-4.1", "Seedream 4.1", "seedream_4.1"),
  imageModel("seedream-4", "Seedream 4", "seedream_4"),
  imageModel("nova2", "Nova 2", "nova2"),
]

const commonVideoCapabilities = {
  aspect_ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
  audio_input: true,
  durations: null,
  first_frame: true,
  last_frame: true,
  seed: true,
  video_input: true,
} as const

export const XIAOYUNQUE_VIDEO_MODELS: readonly XiaoYunqueVideoModelDefinition[] = [
  {
    capabilities: { ...commonVideoCapabilities, resolutions: ["480p", "720p"] },
    description: "Seedance 2.5 video generation with image, video and audio references.",
    id: "xiaoyunque/seedance-2.5",
    kind: "video",
    name: "Seedance 2.5",
    provider: "xiaoyunque",
    upstream_model: "Seedance_2.5",
  },
  {
    capabilities: { ...commonVideoCapabilities, resolutions: ["480p", "720p", "1080p"] },
    description: "Seedance 2.0 Vision video generation.",
    id: "xiaoyunque/seedance-2.0-vision",
    kind: "video",
    name: "Seedance 2.0 Vision",
    provider: "xiaoyunque",
    upstream_model: "seedance2.0_vision",
  },
  {
    capabilities: { ...commonVideoCapabilities, resolutions: ["480p", "720p"] },
    description: "Seedance 2.0 Mini video generation.",
    id: "xiaoyunque/seedance-2.0-mini",
    kind: "video",
    name: "Seedance 2.0 Mini",
    provider: "xiaoyunque",
    upstream_model: "Seedance_2.0_mini",
  },
  {
    capabilities: { ...commonVideoCapabilities, resolutions: ["480p", "720p"] },
    description: "Seedance 2.0 Mini Lite on the non-VIP channel.",
    id: "xiaoyunque/seedance-2.0-mini-lite",
    kind: "video",
    name: "Seedance 2.0 Mini Lite",
    provider: "xiaoyunque",
    upstream_model: "Seedance_2.0_mini_lite",
  },
  {
    capabilities: { ...commonVideoCapabilities, resolutions: ["480p", "720p", "1080p"] },
    description: "Seedance 2.0 direct video generation.",
    id: "xiaoyunque/seedance-2.0",
    kind: "video",
    name: "Seedance 2.0",
    provider: "xiaoyunque",
    upstream_model: "seedance2.0_direct",
  },
]

export const XIAOYUNQUE_MODELS: readonly (XiaoYunqueImageModelDefinition | XiaoYunqueVideoModelDefinition)[] = [
  ...XIAOYUNQUE_IMAGE_MODELS,
  ...XIAOYUNQUE_VIDEO_MODELS,
]

const imageModelsById = new Map(XIAOYUNQUE_IMAGE_MODELS.map(model => [model.id, model]))
const videoModelsById = new Map(XIAOYUNQUE_VIDEO_MODELS.map(model => [model.id, model]))

export function resolveXiaoYunqueImageModel(modelId: string) {
  const model = imageModelsById.get(modelId)
  if (!model) throw new XiaoYunqueInputError(`unknown XiaoYunque image model: ${modelId}`)
  return model
}

export function resolveXiaoYunqueVideoModel(modelId: string) {
  const model = videoModelsById.get(modelId)
  if (!model) throw new XiaoYunqueInputError(`unknown XiaoYunque video model: ${modelId}`)
  return model
}

export function validateXiaoYunqueImageRequest(
  model: XiaoYunqueImageModelDefinition,
  request: ImageCreateRequest,
) {
  if (request.aspect_ratio && !model.capabilities.aspect_ratios?.includes(request.aspect_ratio)) {
    throw new XiaoYunqueInputError(`${model.id} does not support aspect ratio ${request.aspect_ratio}`)
  }
  if (request.resolution && !model.capabilities.resolutions?.includes(request.resolution)) {
    throw new XiaoYunqueInputError(`${model.id} does not support resolution ${request.resolution}`)
  }
  if ((request.input_references?.length ?? 0) > 9) {
    throw new XiaoYunqueInputError("XiaoYunque accepts at most nine image references")
  }
}

export function validateXiaoYunqueVideoRequest(
  model: XiaoYunqueVideoModelDefinition,
  request: VideoCreateRequest,
) {
  if (request.aspect_ratio && !model.capabilities.aspect_ratios?.includes(request.aspect_ratio)) {
    throw new XiaoYunqueInputError(`${model.id} does not support aspect ratio ${request.aspect_ratio}`)
  }
  if (request.resolution && !model.capabilities.resolutions?.includes(request.resolution)) {
    throw new XiaoYunqueInputError(`${model.id} does not support resolution ${request.resolution}`)
  }
  if (request.duration !== undefined && (!Number.isSafeInteger(request.duration) || request.duration < 1 || request.duration > 60)) {
    throw new XiaoYunqueInputError("duration must be an integer from 1 to 60")
  }
  if (request.seed !== undefined && (!Number.isSafeInteger(request.seed) || request.seed < -1 || request.seed > 4_294_967_295)) {
    throw new XiaoYunqueInputError("seed must be an integer from -1 to 4294967295")
  }
  if (request.frame_images?.last_frame && !request.frame_images.first_frame) {
    throw new XiaoYunqueInputError("last_frame requires first_frame")
  }
  if (request.frame_images && request.input_references?.some(reference => reference.type === "image")) {
    throw new XiaoYunqueInputError("use frame_images or ordinary image references, not both")
  }
}

export function publicXiaoYunqueModel(
  model: XiaoYunqueImageModelDefinition | XiaoYunqueVideoModelDefinition,
): ProviderModel {
  const { upstream_model: _upstreamModel, ...result } = model
  return structuredClone(result)
}
