import { RouterError } from "./errors.js"
import type {
  AudioOutput,
  ImageOutput,
  MediaArtifact,
  VideoOutput,
} from "./types.js"

const canonicalMediaTypes = {
  audio: new Set(["audio/aac", "audio/flac", "audio/mpeg", "audio/ogg", "audio/wav"]),
  image: new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]),
  video: new Set(["video/mp4", "video/quicktime", "video/webm"]),
} as const

const aliases = new Map([
  ["audio/mp3", "audio/mpeg"],
  ["audio/x-wav", "audio/wav"],
  ["image/jpg", "image/jpeg"],
  ["video/mov", "video/quicktime"],
])

function safeArtifactUrl(value: string) {
  if (value.length > 16_384) return false
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hash) return false
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"))
  } catch {
    return false
  }
}

export function normalizeArtifacts(
  kind: "audio" | "image" | "video",
  artifacts: readonly MediaArtifact[] | undefined,
  outputs: readonly (AudioOutput | ImageOutput | VideoOutput)[] | undefined,
) {
  const values: readonly (MediaArtifact | AudioOutput | ImageOutput | VideoOutput)[] = artifacts ?? outputs ?? []
  return values.map(value => {
    const rawMediaType = ("media_type" in value ? value.media_type : value.content_type)?.split(";", 1)[0]?.trim().toLowerCase()
    const mediaType = aliases.get(rawMediaType ?? "") ?? rawMediaType
    if (!mediaType || !canonicalMediaTypes[kind].has(mediaType as never)) {
      throw new RouterError(
        "invalid_provider_artifact",
        `provider returned an unsupported ${kind} media type`,
        502,
        { category: "provider_failure", retryable: false },
      )
    }
    if (("kind" in value && value.kind !== kind) || !safeArtifactUrl(value.url)) {
      throw new RouterError(
        "invalid_provider_artifact",
        `provider returned an invalid ${kind} artifact`,
        502,
        { category: "provider_failure", retryable: false },
      )
    }
    if ("media_type" in value) {
      return { ...value, kind, media_type: mediaType } satisfies MediaArtifact
    }
    const { content_type: _contentType, ...legacy } = value
    return { ...legacy, kind, media_type: mediaType } satisfies MediaArtifact
  })
}

export function legacyOutputs(artifacts: readonly MediaArtifact[]) {
  return artifacts.map(artifact => ({ content_type: artifact.media_type, url: artifact.url }))
}
