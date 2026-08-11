import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type {
  ImageCreateRequest,
  ProviderAdapter,
  ProviderImageJobResult,
  ProviderModel,
  ProviderVideoJobResult,
  VideoCreateRequest,
} from "@shortdrama-router/core"
import { LibTvProcessRunner, type LibTvCommandRunner } from "./command.js"
import {
  LibTvAuthenticationError,
  LibTvInputError,
  LibTvUpstreamError,
} from "./errors.js"

interface ModelMatch {
  readonly description?: string
  readonly modelKey?: string
  readonly modelName?: string
}

interface ModelSchema {
  readonly modality?: string
  readonly schema?: {
    readonly modelName?: string
    readonly properties?: Readonly<Record<string, unknown>>
  }
}

interface TerminalNode {
  readonly data?: {
    readonly resourceMeta?: { readonly items?: readonly { readonly kind?: string }[] }
    readonly taskInfo?: {
      readonly status?: number
      readonly taskId?: string
    }
    readonly url?: readonly unknown[]
  }
  readonly nodeKey?: string
  readonly status?: number
  readonly taskId?: string
}

type Scalar = boolean | number | string

export interface LibTvProviderOptions {
  readonly cliPath?: string
  readonly configDir?: string
  readonly projectUuid?: string
  readonly randomId?: () => string
  readonly runner?: LibTvCommandRunner
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
    throw new LibTvUpstreamError(`LibTV CLI returned invalid ${label} JSON`)
  }
}

function lastJsonObject(value: string) {
  const objects: TerminalNode[] = []
  let depth = 0
  let escaped = false
  let inString = false
  let start = -1
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (start === -1) {
      if (character === "{") {
        start = index
        depth = 1
      }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === "\"") inString = false
      continue
    }
    if (character === "\"") inString = true
    else if (character === "{") depth += 1
    else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        try {
          objects.push(JSON.parse(value.slice(start, index + 1)) as TerminalNode)
        } catch {
          // Ignore non-JSON brace blocks emitted by the CLI and keep scanning.
        }
        start = -1
      }
    }
  }
  const result = objects.at(-1)
  if (result) return result
  throw new LibTvUpstreamError("LibTV CLI did not return a terminal result")
}

function modelKey(model: string) {
  const value = model.startsWith("libtv/") ? model.slice("libtv/".length) : model
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new LibTvInputError("LibTV model id is invalid")
  }
  return value
}

function projectUuid(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/u.test(value)) {
    throw new LibTvInputError("LibTV project_uuid must be a 32-character lowercase UUID")
  }
  return value
}

function scalar(value: unknown, label: string): Scalar {
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw new LibTvInputError(`${label} must be a string, number or boolean`)
}

function settingArg(key: string, value: Scalar) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)) {
    throw new LibTvInputError(`LibTV setting ${key} is invalid`)
  }
  return `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`
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

function resultFromNode(kind: "image" | "video", value: TerminalNode) {
  const urls = (value.data?.url ?? []).map(safeMediaUrl).filter((url): url is string => url !== undefined)
  const status = value.status ?? value.data?.taskInfo?.status
  const taskId = value.taskId ?? value.data?.taskInfo?.taskId
  if (status !== 2 || urls.length === 0 || !value.nodeKey || !taskId) {
    throw new LibTvUpstreamError(`LibTV ${kind} generation did not complete successfully`)
  }
  const outputs = urls.map(url => ({
    content_type: kind === "image" ? "image/png" : "video/mp4",
    url,
  }))
  return {
    outputs,
    reference: {
      kind,
      node_key: value.nodeKey,
      outputs,
      status: "completed",
      task_id: taskId,
    },
    status: "completed",
  } as const
}

function storedResult(reference: Readonly<Record<string, unknown>>, kind: "image" | "video") {
  if (reference.kind !== kind || reference.status !== "completed" || !Array.isArray(reference.outputs)) {
    throw new LibTvInputError(`LibTV ${kind} job reference is invalid`)
  }
  const outputs = reference.outputs.flatMap(item => {
    const value = record(item)
    const url = safeMediaUrl(value?.url)
    return url === undefined ? [] : [{
      content_type: kind === "image" ? "image/png" : "video/mp4",
      url,
    }]
  })
  if (outputs.length === 0) throw new LibTvInputError(`LibTV ${kind} job reference is invalid`)
  return { outputs, reference, status: "completed" } as const
}

export class LibTvProvider implements ProviderAdapter {
  readonly metadata = {
    capabilities: {
      authorization: ["oauth"],
      generation: ["image", "video"],
      models: true,
      usage: false,
    },
    description: "LibTV image and video generation through the official local LibTV CLI.",
    id: "libtv",
    name: "LibTV",
  } as const

  readonly #configDir: string
  readonly #projectUuid: string | undefined
  readonly #randomId: () => string
  readonly #runner: LibTvCommandRunner

  constructor(options: LibTvProviderOptions = {}) {
    this.#configDir = options.configDir ?? process.env.LIBTV_CONFIG_DIR ?? path.join(homedir(), ".libtv")
    this.#projectUuid = options.projectUuid === undefined ? undefined : projectUuid(options.projectUuid)
    this.#randomId = options.randomId ?? randomUUID
    this.#runner = options.runner ?? new LibTvProcessRunner(
      options.cliPath === undefined ? {} : { cliPath: options.cliPath },
    )
  }

  async getAuthorizationStatus(options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    const configured = existsSync(path.join(this.#configDir, "credentials.json"))
    if (!configured) {
      return {
        authorized: false,
        configured: false,
        method: null,
        reason: "run `libtv login web --open` with the official CLI",
        state: "not_configured",
      } as const
    }
    if (!options.probe) {
      return { authorized: null, configured: true, method: "oauth", state: "configured" } as const
    }
    try {
      await this.#runner.run(["account", "info"], options.signal)
      return {
        authorized: true,
        configured: true,
        method: "oauth",
        state: "valid",
        verified_at: new Date().toISOString(),
      } as const
    } catch (error) {
      if (error instanceof LibTvAuthenticationError) {
        return {
          authorized: false,
          configured: true,
          method: "oauth",
          reason: "LibTV rejected the locally stored login",
          state: "expired",
          verified_at: new Date().toISOString(),
        } as const
      }
      throw error
    }
  }

  async listModels(options: { readonly signal?: AbortSignal } = {}) {
    const models: ProviderModel[] = []
    for (const kind of ["image", "video"] as const) {
      const output = await this.#runner.run(["model", "search", "--type", kind], options.signal)
      const parsed = record(parseJson(output.stdout, "model catalog"))
      const matches = Array.isArray(parsed?.matches) ? parsed.matches : []
      for (const item of matches) {
        const match = record(item) as ModelMatch | undefined
        if (!match?.modelKey || !match.modelName) continue
        models.push({
          capabilities: { authorization: ["oauth"] },
          description: match.description ?? `${match.modelName} on LibTV.`,
          id: `libtv/${match.modelKey}`,
          kind,
          name: match.modelName,
          provider: "libtv",
        })
      }
    }
    return models
  }

  async createImage(request: ImageCreateRequest, signal?: AbortSignal): Promise<ProviderImageJobResult> {
    if ((request.input_references?.length ?? 0) > 0) {
      throw new LibTvInputError("LibTV image references are not supported by this adapter yet")
    }
    return this.#create("image", request, signal)
  }

  async getImage(reference: Readonly<Record<string, unknown>>): Promise<ProviderImageJobResult> {
    return storedResult(reference, "image")
  }

  async createVideo(request: VideoCreateRequest, signal?: AbortSignal): Promise<ProviderVideoJobResult> {
    if ((request.input_references?.length ?? 0) > 0 || request.frame_images !== undefined) {
      throw new LibTvInputError("LibTV video references are not supported by this adapter yet")
    }
    return this.#create("video", request, signal)
  }

  async getVideo(reference: Readonly<Record<string, unknown>>): Promise<ProviderVideoJobResult> {
    return storedResult(reference, "video")
  }

  async #create(
    kind: "image" | "video",
    request: ImageCreateRequest | VideoCreateRequest,
    signal?: AbortSignal,
  ) {
    const key = modelKey(request.model)
    const catalogOutput = await this.#runner.run(["model", "search", "--type", kind, key], signal)
    const catalog = record(parseJson(catalogOutput.stdout, "model catalog"))
    const catalogMatches = Array.isArray(catalog?.matches) ? catalog.matches : []
    const catalogModel = catalogMatches
      .map(item => record(item) as ModelMatch | undefined)
      .find(item => item?.modelKey === key)
    const schemaOutput = await this.#runner.run(["model", key], signal)
    const schema = parseJson(schemaOutput.stdout, "model schema") as ModelSchema
    if (schema.modality !== kind || !catalogModel?.modelName) {
      throw new LibTvInputError(`LibTV model ${key} is not a ${kind} model`)
    }
    const providerOptions = record(request.provider_options) ?? {}
    const targetProject = projectUuid(providerOptions.project_uuid ?? this.#projectUuid)
    const settings = record(providerOptions.settings) ?? {}
    const args = [
      "node",
      "create",
      `shortdrama-router-${kind}-${this.#randomId()}`,
      "-p",
      targetProject,
      "-t",
      kind,
      "--prompt",
      request.prompt,
      "-s",
      settingArg("model", catalogModel.modelName),
      "-s",
      settingArg("modeType", scalar(providerOptions.mode_type ?? `text2${kind}`, "mode_type")),
    ]
    const standard: Array<readonly [string, unknown]> = [
      ["ratio", request.aspect_ratio],
      ["resolution", request.resolution],
      ["count", kind === "image" ? (request as ImageCreateRequest).n : undefined],
      ["duration", kind === "video" ? (request as VideoCreateRequest).duration : undefined],
    ]
    for (const [name, value] of Object.entries(settings)) {
      if (name === "model" || name === "modeType" || name === "prompt") {
        throw new LibTvInputError(`settings.${name} is reserved by the adapter`)
      }
      args.push("-s", settingArg(name, scalar(value, `settings.${name}`)))
    }
    for (const [name, value] of standard) {
      if (value !== undefined) args.push("-s", settingArg(name, scalar(value, name)))
    }
    args.push("--run")
    const result = await this.#runner.run(args, signal)
    return resultFromNode(kind, lastJsonObject(`${result.stdout}\n${result.stderr ?? ""}`))
  }
}
