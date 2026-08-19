import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type {
  AuthorizationMethod,
  ImageCreateRequest,
  ProviderAdapter,
  ProviderAuthorizationCompletion,
  ProviderImageJobResult,
  ProviderModel,
  ProviderVideoJobResult,
  VideoCreateRequest,
} from "@shortdrama-router/core"
import { JimengProcessRunner, type JimengCommandRunner } from "./command.js"
import {
  JimengAuthenticationError,
  JimengInputError,
  JimengUpstreamError,
} from "./errors.js"

const imageRatios = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const
const videoRatios = ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"] as const
const authorizationLifetimeMs = 10 * 60_000

interface PendingAuthorization {
  readonly deviceCode?: string
  readonly expiresAt: number
  readonly id: string
}

export interface JimengProviderOptions {
  readonly cliPath?: string
  readonly configDir?: string
  readonly now?: () => Date
  readonly runner?: JimengCommandRunner
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseJson(value: string, label: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    const lines = value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]
      if (!line?.startsWith("{")) continue
      try {
        return JSON.parse(line) as unknown
      } catch {
        continue
      }
    }
    throw new JimengUpstreamError(`Dreamina CLI returned invalid ${label} JSON`)
  }
}

function localModel(model: string) {
  const value = model.startsWith("jimeng/") ? model.slice("jimeng/".length) : model
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)) {
    throw new JimengInputError("Jimeng model id is invalid")
  }
  return value
}

function versionsFromHelp(value: string) {
  const match = /model_version:\s*([^\r\n]+)/u.exec(value)
  if (!match?.[1]) throw new JimengUpstreamError("Dreamina CLI help did not include model versions")
  return match[1].split(",").map(item => item.trim()).filter(Boolean)
}

function safeMediaUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 16_384) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function mediaUrls(value: unknown, depth = 0, seen = new Set<object>()): string[] {
  if (depth > 8) return []
  const url = safeMediaUrl(value)
  if (url) return [url]
  if (Array.isArray(value)) return value.flatMap(item => mediaUrls(item, depth + 1, seen))
  const valueRecord = record(value)
  if (!valueRecord || seen.has(valueRecord)) return []
  seen.add(valueRecord)
  return Object.values(valueRecord).flatMap(item => mediaUrls(item, depth + 1, seen))
}

function cleanFailure(value: unknown) {
  if (typeof value !== "string") return "Jimeng generation failed"
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim()
  return normalized.length > 0 && normalized.length <= 500 ? normalized : "Jimeng generation failed"
}

function mediaType(kind: "image" | "video", url: string) {
  const pathname = new URL(url).pathname.toLowerCase()
  if (kind === "image") {
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg"
    if (pathname.endsWith(".png")) return "image/png"
    return "image/webp"
  }
  if (pathname.endsWith(".webm")) return "video/webm"
  if (pathname.endsWith(".mov")) return "video/quicktime"
  return "video/mp4"
}

function jobResult(kind: "image" | "video", value: unknown) {
  const result = record(value)
  const submitId = result?.submit_id
  if (!result || typeof submitId !== "string" || !/^[A-Za-z0-9._-]{1,256}$/u.test(submitId)) {
    throw new JimengUpstreamError("Dreamina CLI did not return a valid submit_id")
  }
  const genStatus = result.gen_status
  const status = genStatus === "success"
    ? "completed"
    : genStatus === "fail"
      ? "failed"
      : "in_progress"
  const mediaPattern = kind === "image"
    ? /\.(?:jpe?g|png|webp)$/iu
    : /\.(?:m4v|mov|mp4|webm)$/iu
  const urls = [...new Set(mediaUrls(result).filter(url => mediaPattern.test(new URL(url).pathname)))]
  const outputs = urls.map(url => ({
    content_type: mediaType(kind, url),
    url,
  }))
  if (status === "completed" && outputs.length === 0) {
    throw new JimengUpstreamError(`Jimeng ${kind} generation completed without output`)
  }
  return {
    ...(status === "failed" ? {
      error: { code: "jimeng_generation_failed", message: cleanFailure(result.fail_reason) },
    } : {}),
    ...(outputs.length === 0 ? {} : { outputs }),
    reference: { kind, submit_id: submitId },
    status,
  } as ProviderImageJobResult | ProviderVideoJobResult
}

function imageResolutions(model: string) {
  if (model === "3.0" || model === "3.1") return ["1k", "2k"] as const
  if (model === "5.0Pro") return ["1k", "2k", "4k"] as const
  return ["2k", "4k"] as const
}

function videoResolutions(model: string) {
  if (model === "seedance2.5") return ["480p", "720p"] as const
  if (model === "seedance2.0_vip") return ["720p", "1080p", "4k"] as const
  return ["720p"] as const
}

function publicName(kind: "image" | "video", version: string) {
  if (kind === "image" && version === "5.0") return "Image 5.0 Lite"
  if (kind === "image" && version === "5.0Pro") return "Image 5.0 Pro"
  if (kind === "image") return `Image ${version}`
  return version
    .replace("seedance", "Seedance ")
    .replace("fast", " Fast")
    .replace("_vip", " VIP")
    .replace("mini", " Mini")
}

export class JimengProvider implements ProviderAdapter {
  readonly metadata = {
    capabilities: {
      authorization: ["oauth"],
      authorization_methods: [{
        actions: ["status", "begin", "complete", "cancel", "clear"],
        management: "managed",
        method: "oauth",
      }],
      cancellation: [],
      generation: ["image", "video"],
      ingestion: [],
      models: true,
      usage: false,
    },
    contract_version: "2026-08-18",
    dependencies: [{
      executable: "dreamina",
      id: "dreamina-cli",
      kind: "executable",
      managed_install: true,
      required: true,
      source_url: "https://jimeng.jianying.com/ai-tool/install",
      version_command: ["--version"],
    }],
    description: "Jimeng image and video generation through the official local Dreamina CLI.",
    id: "jimeng",
    name: "Jimeng",
  } as const

  readonly #configDir: string
  readonly #now: () => Date
  #pending: PendingAuthorization | undefined
  readonly #runner: JimengCommandRunner

  constructor(options: JimengProviderOptions = {}) {
    this.#configDir = options.configDir ?? path.join(homedir(), ".dreamina_cli")
    this.#now = options.now ?? (() => new Date())
    this.#runner = options.runner ?? new JimengProcessRunner(
      options.cliPath === undefined ? {} : { cliPath: options.cliPath },
    )
  }

  async getAuthorizationStatus(options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    const configured = existsSync(this.#configDir)
    if (!configured) {
      return {
        authorized: false,
        configured: false,
        method: null,
        reason: "authorize with the official Dreamina CLI",
        reason_code: "authorization_not_configured",
        state: "not_configured",
      } as const
    }
    if (!options.probe) {
      return { authorized: null, configured: true, method: "oauth", state: "configured" } as const
    }
    try {
      const output = await this.#runner.run(["user_credit"], options.signal)
      const account = record(parseJson(output.stdout, "account"))
      const planUnsupported = account?.vip_level === "" || account?.vip_level === null
      return {
        authorized: true,
        configured: true,
        method: "oauth",
        ...(planUnsupported ? {
          reason: "authorized, but official CLI generation requires an Advanced membership",
          reason_code: "plan_generation_unsupported",
        } : {}),
        state: "valid",
        verified_at: this.#now().toISOString(),
      } as const
    } catch (error) {
      if (error instanceof JimengAuthenticationError) {
        return {
          authorized: false,
          configured: true,
          method: "oauth",
          reason: "Jimeng rejected the locally stored OAuth login",
          reason_code: "authorization_rejected",
          state: "expired",
          verified_at: this.#now().toISOString(),
        } as const
      }
      throw error
    }
  }

  async beginAuthorization(method: AuthorizationMethod, signal?: AbortSignal) {
    if (method !== "oauth") throw new JimengInputError("Jimeng supports OAuth authorization only")
    const result = await this.#runner.run(["login", "--headless"], signal)
    const id = randomUUID()
    const expiresAt = this.#now().getTime() + authorizationLifetimeMs
    if (/已复用当前本地 OAuth 登录态/u.test(result.stdout)) {
      this.#pending = { expiresAt, id }
      return {
        authorization_id: id,
        expires_at: new Date(expiresAt).toISOString(),
        login_url: "https://jimeng.jianying.com/ai-tool/install",
        method: "oauth",
      } as const
    }
    const loginUrl = /^verification_uri:\s*(https:\/\/\S+)$/mu.exec(result.stdout)?.[1]
    const deviceCode = /^device_code:\s*([A-Za-z0-9._-]+)$/mu.exec(result.stdout)?.[1]
    if (!loginUrl || !deviceCode) {
      throw new JimengUpstreamError("Dreamina CLI did not return OAuth device-flow material")
    }
    this.#pending = { deviceCode, expiresAt, id }
    return {
      authorization_id: id,
      expires_at: new Date(expiresAt).toISOString(),
      login_url: loginUrl,
      method: "oauth",
    } as const
  }

  async completeAuthorization(completion: ProviderAuthorizationCompletion, signal?: AbortSignal) {
    const pending = this.#pending
    if (
      completion.method !== "oauth"
      || !pending
      || completion.authorization_id !== pending.id
      || pending.expiresAt <= this.#now().getTime()
    ) {
      throw new JimengInputError("Jimeng authorization completion is stale or invalid")
    }
    if (pending.deviceCode) {
      await this.#runner.run([
        "login",
        "checklogin",
        `--device_code=${pending.deviceCode}`,
        "--poll=30",
      ], signal)
    }
    this.#pending = undefined
    return this.getAuthorizationStatus({ probe: true, ...(signal === undefined ? {} : { signal }) })
  }

  async cancelAuthorization(authorizationId: string) {
    if (!this.#pending || this.#pending.id !== authorizationId) {
      throw new JimengInputError("Jimeng authorization request was not found")
    }
    this.#pending = undefined
  }

  async clearAuthorization(signal?: AbortSignal) {
    await this.#runner.run(["logout"], signal)
    this.#pending = undefined
  }

  async getDependencyStatuses(options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    const dependency = this.metadata.dependencies[0]
    if (!options.probe) return [{ ...dependency, available: null, compatible: null, reason_code: "dependency_unprobed" }] as const
    try {
      const result = await this.#runner.run(dependency.version_command, options.signal)
      const version = result.stdout.trim().slice(0, 256)
      const start = version.indexOf("{")
      const end = version.indexOf("}", start + 1)
      let recognized: string | undefined
      if (start !== -1 && end !== -1) {
        try {
          const value = JSON.parse(version.slice(start, end + 1)) as { version?: unknown }
          if (typeof value.version === "string" && value.version.trim()) recognized = value.version.trim()
        } catch {
          // An unrecognized version is reported as incompatible below.
        }
      }
      return [{
        ...dependency,
        available: true,
        compatible: recognized !== undefined,
        ...(recognized ? { version: recognized } : version ? { version } : {}),
        ...(recognized ? {} : {
          reason: "Dreamina CLI version could not be recognized",
          reason_code: "dependency_version_unrecognized",
        }),
      }] as const
    } catch {
      return [{
        ...dependency,
        available: false,
        compatible: null,
        reason: "the official Dreamina CLI is unavailable or its version could not be read",
        reason_code: "dependency_unavailable",
      }] as const
    }
  }

  async listModels(options: { readonly signal?: AbortSignal } = {}) {
    const imageHelp = await this.#runner.run(["text2image", "-h"], options.signal)
    const videoHelp = await this.#runner.run(["text2video", "-h"], options.signal)
    const models: ProviderModel[] = versionsFromHelp(imageHelp.stdout).map(version => ({
      capabilities: {
        aspect_ratios: imageRatios,
        authorization: ["oauth"],
        constraints: {
          aspect_ratio: { kind: "enum", values: imageRatios },
          resolution: { kind: "enum", values: imageResolutions(version) },
        },
        output_media_types: ["image/jpeg", "image/png", "image/webp"],
        references: { image: false },
        resolutions: imageResolutions(version),
      },
      description: `${publicName("image", version)} through the official Dreamina CLI.`,
      id: `jimeng/${version}`,
      kind: "image",
      name: publicName("image", version),
      provider: "jimeng",
    }))
    for (const version of versionsFromHelp(videoHelp.stdout)) {
      const maximumDuration = version === "seedance2.5" ? 30 : 15
      models.push({
        capabilities: {
          aspect_ratios: videoRatios,
          authorization: ["oauth"],
          constraints: {
            aspect_ratio: { kind: "enum", values: videoRatios },
            duration: { kind: "range", min: 4, max: maximumDuration, step: 1 },
            resolution: { kind: "enum", values: videoResolutions(version) },
          },
          durations: Array.from({ length: maximumDuration - 3 }, (_, index) => index + 4),
          output_media_types: ["video/mp4", "video/quicktime", "video/webm"],
          references: { audio: false, first_frame: false, image: false, last_frame: false, video: false },
          resolutions: videoResolutions(version),
        },
        description: `${publicName("video", version)} through the official Dreamina CLI.`,
        id: `jimeng/${version}`,
        kind: "video",
        name: publicName("video", version),
        provider: "jimeng",
      })
    }
    return models
  }

  async createImage(request: ImageCreateRequest, signal?: AbortSignal): Promise<ProviderImageJobResult> {
    if ((request.input_references?.length ?? 0) > 0) {
      throw new JimengInputError("Jimeng text2image does not accept image references")
    }
    const version = localModel(request.model)
    const model = (await this.listModels({ ...(signal === undefined ? {} : { signal }) }))
      .find(item => item.id === `jimeng/${version}` && item.kind === "image")
    if (!model) throw new JimengInputError(`Jimeng image model ${version} is unsupported by the installed CLI`)
    const resolution = (request.resolution ?? "2k").toLowerCase()
    if (!model.capabilities.resolutions?.includes(resolution)) {
      throw new JimengInputError(`resolution ${resolution} is unsupported by jimeng/${version}`)
    }
    const ratio = request.aspect_ratio ?? "16:9"
    if (!imageRatios.includes(ratio as typeof imageRatios[number])) {
      throw new JimengInputError(`aspect ratio ${ratio} is unsupported by Jimeng images`)
    }
    const args = [
      "text2image",
      "--prompt", request.prompt,
      "--model_version", version,
      "--ratio", ratio,
      "--resolution_type", resolution,
      "--generate_num", String(request.n ?? 1),
      "--poll=0",
    ]
    const output = await this.#runner.run(args, signal)
    return jobResult("image", parseJson(output.stdout, "image task")) as ProviderImageJobResult
  }

  async getImage(reference: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<ProviderImageJobResult> {
    return this.#get(reference, "image", signal) as Promise<ProviderImageJobResult>
  }

  async createVideo(request: VideoCreateRequest, signal?: AbortSignal): Promise<ProviderVideoJobResult> {
    if ((request.input_references?.length ?? 0) > 0 || request.frame_images !== undefined) {
      throw new JimengInputError("Jimeng text2video does not accept media references")
    }
    const version = localModel(request.model)
    const model = (await this.listModels({ ...(signal === undefined ? {} : { signal }) }))
      .find(item => item.id === `jimeng/${version}` && item.kind === "video")
    if (!model) throw new JimengInputError(`Jimeng video model ${version} is unsupported by the installed CLI`)
    const resolution = (request.resolution ?? "720p").toLowerCase()
    if (!model.capabilities.resolutions?.includes(resolution)) {
      throw new JimengInputError(`resolution ${resolution} is unsupported by jimeng/${version}`)
    }
    const ratio = request.aspect_ratio ?? "16:9"
    if (!videoRatios.includes(ratio as typeof videoRatios[number])) {
      throw new JimengInputError(`aspect ratio ${ratio} is unsupported by Jimeng videos`)
    }
    const duration = request.duration ?? 5
    if (!model.capabilities.durations?.includes(duration)) {
      throw new JimengInputError(`duration ${duration} is unsupported by jimeng/${version}`)
    }
    const output = await this.#runner.run([
      "text2video",
      "--prompt", request.prompt,
      "--model_version", version,
      "--ratio", ratio,
      "--video_resolution", resolution,
      "--duration", String(duration),
      "--poll=0",
    ], signal)
    return jobResult("video", parseJson(output.stdout, "video task")) as ProviderVideoJobResult
  }

  async getVideo(reference: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<ProviderVideoJobResult> {
    return this.#get(reference, "video", signal) as Promise<ProviderVideoJobResult>
  }

  async #get(reference: Readonly<Record<string, unknown>>, kind: "image" | "video", signal?: AbortSignal) {
    if (reference.kind !== kind || typeof reference.submit_id !== "string") {
      throw new JimengInputError(`Jimeng ${kind} job reference is invalid`)
    }
    const output = await this.#runner.run([
      "query_result",
      `--submit_id=${reference.submit_id}`,
    ], signal)
    return jobResult(kind, parseJson(output.stdout, `${kind} result`))
  }
}
