import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { RuntimeIntegrityError } from "@shortdrama-router/runtime"
import type {
  AuthorizationMethod,
  ImageCreateRequest,
  ProviderAdapter,
  ProviderAuthorizationCompletion,
  ProviderConfigurationSelection,
  ProviderImageJobResult,
  ProviderModel,
  ProviderModelConstraints,
  ProviderOptionsSchema,
  ProviderVideoJobResult,
  VideoCreateRequest,
} from "@shortdrama-router/core"
import {
  LibTvProcessRunner,
  type LibTvCommandRunner,
  type LibTvWebAuthorizationSession,
} from "./command.js"
import {
  MemoryLibTvConfiguration,
  type LibTvConfigurationSource,
} from "./configuration.js"
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
type PendingAuthorizationState = "failed" | "pending" | "succeeded"

interface PendingAuthorization {
  readonly expiresAt: number
  readonly id: string
  readonly session: LibTvWebAuthorizationSession
  reason?: string
  state: PendingAuthorizationState
}

const authorizationLifetimeMs = 10 * 60_000

export interface LibTvProviderOptions {
  readonly cliPath?: string
  readonly configuration?: LibTvConfigurationSource
  readonly configDir?: string
  readonly projectUuid?: string
  readonly now?: () => Date
  readonly randomId?: () => string
  readonly runner?: LibTvCommandRunner
  readonly runtimeRootDir?: string
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
    content_type: mediaType(kind, url),
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

function mediaType(kind: "image" | "video", url: string) {
  const pathname = new URL(url).pathname.toLowerCase()
  if (kind === "image") {
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg"
    if (pathname.endsWith(".webp")) return "image/webp"
    if (pathname.endsWith(".gif")) return "image/gif"
    return "image/png"
  }
  if (pathname.endsWith(".webm")) return "video/webm"
  if (pathname.endsWith(".mov")) return "video/quicktime"
  return "video/mp4"
}

function storedResult(reference: Readonly<Record<string, unknown>>, kind: "image" | "video") {
  if (reference.kind !== kind || reference.status !== "completed" || !Array.isArray(reference.outputs)) {
    throw new LibTvInputError(`LibTV ${kind} job reference is invalid`)
  }
  const outputs = reference.outputs.flatMap(item => {
    const value = record(item)
    const url = safeMediaUrl(value?.url)
    return url === undefined ? [] : [{
      content_type: mediaType(kind, url),
      url,
    }]
  })
  if (outputs.length === 0) throw new LibTvInputError(`LibTV ${kind} job reference is invalid`)
  return { outputs, reference, status: "completed" } as const
}

function propertyValues(property: unknown) {
  const value = record(property)
  const values = Array.isArray(value?.enum)
    ? value.enum.filter(item => typeof item === "string" || (typeof item === "number" && Number.isFinite(item)))
    : undefined
  return { value, values }
}

function publicModelSchema(properties: Readonly<Record<string, unknown>> | undefined) {
  if (!properties) return {}
  const stringConstraint = (name: string) => {
    const { value, values } = propertyValues(properties[name])
    const strings = values?.filter((item): item is string => typeof item === "string")
    if (strings?.length) return { kind: "enum" as const, values: strings }
    return { kind: "unknown" as const }
  }
  const numberConstraint = (name: string) => {
    const { value, values } = propertyValues(properties[name])
    const numbers = values?.filter((item): item is number => typeof item === "number")
    if (numbers?.length) return { kind: "enum" as const, values: numbers }
    if (typeof value?.minimum === "number" && typeof value.maximum === "number") {
      return {
        kind: "range" as const,
        max: value.maximum,
        min: value.minimum,
        ...(typeof value.multipleOf === "number" ? { step: value.multipleOf } : {}),
      }
    }
    return { kind: "unknown" as const }
  }
  const schemaProperties = Object.fromEntries(Object.entries(properties).flatMap(([name, property]) => {
    if (name === "model" || name === "prompt") return []
    const { value, values } = propertyValues(property)
    const type = value?.type
    if (type !== "boolean" && type !== "number" && type !== "object" && type !== "string" && type !== "integer") return []
    return [[name, {
      ...(typeof value?.description === "string" ? { description: value.description.slice(0, 512) } : {}),
      ...(values?.every(item => typeof item === "string" || typeof item === "number") ? { enum: values } : {}),
      type: type === "integer" ? "number" : type,
    }]]
  }))
  const constraints: ProviderModelConstraints = {
    aspect_ratio: stringConstraint("ratio"),
    duration: numberConstraint("duration"),
    resolution: stringConstraint("resolution"),
  }
  const providerOptionsSchema: ProviderOptionsSchema = {
    additional_properties: false,
    properties: schemaProperties as ProviderOptionsSchema["properties"],
  }
  return {
    constraints,
    provider_options_schema: {
      ...providerOptionsSchema,
    },
  }
}

export class LibTvProvider implements ProviderAdapter {
  readonly metadata = {
    capabilities: {
      authorization: ["oauth"],
      authorization_methods: [{
        actions: ["status", "begin", "complete", "cancel", "clear"],
        management: "managed",
        method: "oauth",
      }],
      cancellation: [],
      configuration: true,
      generation: ["image", "video"],
      ingestion: [],
      models: true,
      usage: false,
    },
    contract_version: "2026-08-18",
    dependencies: [{
      executable: "libtv",
      id: "libtv-cli",
      kind: "executable",
      managed_install: true,
      required: true,
      source_url: "https://liblibai-web-static.liblib.cloud/cli/",
      version_command: ["--version"],
    }],
    description: "LibTV image and video generation through the official local LibTV CLI.",
    id: "libtv",
    name: "LibTV",
  } as const

  readonly #configDir: string
  readonly #configuration: LibTvConfigurationSource
  readonly #now: () => Date
  #pending: PendingAuthorization | undefined
  readonly #randomId: () => string
  readonly #runner: LibTvCommandRunner

  constructor(options: LibTvProviderOptions = {}) {
    this.#configDir = options.configDir ?? process.env.LIBTV_CONFIG_DIR ?? path.join(homedir(), ".libtv")
    const configuredProject = options.projectUuid === undefined
      ? undefined
      : { id: projectUuid(options.projectUuid), name: options.projectUuid, type: "project" } as const
    this.#configuration = options.configuration ?? new MemoryLibTvConfiguration(
      configuredProject === undefined ? {} : { project: configuredProject },
    )
    this.#now = options.now ?? (() => new Date())
    this.#randomId = options.randomId ?? randomUUID
    this.#runner = options.runner ?? new LibTvProcessRunner(
      {
        ...(options.cliPath === undefined ? {} : { cliPath: options.cliPath }),
        configDir: this.#configDir,
        ...(options.runtimeRootDir === undefined ? {} : { runtimeRootDir: options.runtimeRootDir }),
      },
    )
  }

  async getAuthorizationStatus(options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    const pending = this.#pending
    if (pending?.state === "pending" && pending.expiresAt <= this.#now().getTime()) {
      pending.session.cancel()
      pending.reason = "LibTV web login expired before completion"
      pending.state = "failed"
    }
    if (pending?.state === "pending") {
      return {
        authorized: null,
        configured: false,
        expires_at: new Date(pending.expiresAt).toISOString(),
        method: "oauth",
        reason: "complete the LibTV login in the opened browser",
        reason_code: "authorization_pending",
        state: "pending",
      } as const
    }
    if (pending?.state === "failed") {
      return {
        authorized: false,
        configured: false,
        method: "oauth",
        reason: pending.reason ?? "LibTV web login failed",
        reason_code: "authorization_failed",
        state: "error",
      } as const
    }
    const configured = existsSync(path.join(this.#configDir, "credentials.json"))
    if (!configured) {
      return {
        authorized: false,
        configured: false,
        method: null,
        reason: "start LibTV Web OAuth through the provider authorization API",
        reason_code: "authorization_not_configured",
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
          reason_code: "authorization_rejected",
          state: "expired",
          verified_at: new Date().toISOString(),
        } as const
      }
      throw error
    }
  }

  async beginAuthorization(method: AuthorizationMethod, signal?: AbortSignal) {
    if (method !== "oauth") throw new LibTvInputError("LibTV supports OAuth authorization only")
    if (!this.#runner.beginWebAuthorization) {
      throw new LibTvInputError("the configured LibTV command runner does not support managed web login")
    }
    const previous = this.#pending
    if (previous) {
      this.#pending = undefined
      previous.session.cancel()
      await previous.session.completed.catch(() => {})
    }
    const session = await this.#runner.beginWebAuthorization(signal)
    const pending: PendingAuthorization = {
      expiresAt: this.#now().getTime() + authorizationLifetimeMs,
      id: this.#randomId(),
      session,
      state: "pending",
    }
    this.#pending = pending
    void session.completed.then(() => {
      if (this.#pending === pending && pending.state === "pending") pending.state = "succeeded"
    }, () => {
      if (this.#pending === pending && pending.state === "pending") {
        pending.reason = "LibTV web login did not complete successfully"
        pending.state = "failed"
      }
    })
    return {
      authorization_id: pending.id,
      expires_at: new Date(pending.expiresAt).toISOString(),
      login_url: session.login_url,
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
      throw new LibTvInputError("LibTV authorization completion is stale or invalid")
    }
    if (pending.state !== "succeeded") {
      return this.getAuthorizationStatus({ probe: true, ...(signal === undefined ? {} : { signal }) })
    }
    this.#pending = undefined
    return this.getAuthorizationStatus({ probe: true, ...(signal === undefined ? {} : { signal }) })
  }

  async cancelAuthorization(authorizationId: string) {
    const pending = this.#pending
    if (!pending || pending.id !== authorizationId) {
      throw new LibTvInputError("LibTV authorization request was not found")
    }
    this.#pending = undefined
    pending.session.cancel()
    await pending.session.completed.catch(() => {})
  }

  async clearAuthorization(signal?: AbortSignal) {
    const pending = this.#pending
    this.#pending = undefined
    if (pending) {
      pending.session.cancel()
      await pending.session.completed.catch(() => {})
    }
    await this.#runner.run(["logout"], signal)
  }

  async getDependencyStatuses(options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    const dependency = this.metadata.dependencies[0]
    if (!options.probe) return [{ ...dependency, available: null, compatible: null, reason_code: "dependency_unprobed" }] as const
    try {
      const result = await this.#runner.run(dependency.version_command, options.signal)
      const version = result.stdout.trim().slice(0, 256)
      const recognized = version.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/u)?.[1]
      const compatible = recognized === "1.0.2"
      return [{
        ...dependency,
        available: true,
        compatible,
        ...(recognized ? { version: recognized } : version ? { version } : {}),
        ...(compatible ? {} : {
          reason: recognized
            ? `LibTV CLI ${recognized} is not supported; install 1.0.2`
            : "LibTV CLI version could not be recognized",
          reason_code: recognized ? "dependency_version_incompatible" : "dependency_version_unrecognized",
        }),
      }] as const
    } catch (error) {
      if (error instanceof RuntimeIntegrityError) {
        return [{
          ...dependency,
          available: true,
          compatible: false,
          reason: error.message,
          reason_code: error.code,
        }] as const
      }
      return [{
        ...dependency,
        available: false,
        compatible: null,
        reason: "the official LibTV CLI is unavailable or its version could not be read",
        reason_code: "dependency_unavailable",
      }] as const
    }
  }

  async getConfigurationStatus(options: { readonly probe?: boolean; readonly signal?: AbortSignal } = {}) {
    const snapshot = await this.#configuration.read()
    if (!snapshot.project) {
      return {
        configured: false,
        reason: "select a LibTV project before generation",
        reason_code: "project_required",
        state: "configuration_required",
      } as const
    }
    if (!options.probe) {
      return { configured: true, resource: snapshot.project, state: "configuration_configured" } as const
    }
    try {
      const projects = await this.listResources({ ...(options.signal ? { signal: options.signal } : {}), type: "project" })
      const project = projects.find(item => item.id === snapshot.project?.id)
      if (!project) {
        return {
          configured: true,
          reason: "the selected LibTV project is not available to the current account",
          reason_code: "project_unavailable",
          resource: snapshot.project,
          state: "configuration_unavailable",
          verified_at: new Date().toISOString(),
        } as const
      }
      return {
        configured: true,
        resource: project,
        state: "configuration_valid",
        verified_at: new Date().toISOString(),
      } as const
    } catch {
      return {
        configured: true,
        reason: "LibTV project configuration could not be verified",
        reason_code: "configuration_probe_failed",
        resource: snapshot.project,
        state: "error",
        verified_at: new Date().toISOString(),
      } as const
    }
  }

  async listResources(options: { readonly signal?: AbortSignal; readonly type?: string } = {}) {
    if (options.type !== undefined && options.type !== "project") return []
    const result = await this.#runner.run(["project", "list", "--page-size", "100"], options.signal)
    const parsed = record(parseJson(result.stdout, "project list"))
    const values = Array.isArray(parsed?.projectMetaList) ? parsed.projectMetaList : []
    return values.flatMap(value => {
      const item = record(value)
      if (typeof item?.uuid !== "string" || typeof item.name !== "string") return []
      try {
        return [{ id: projectUuid(item.uuid), name: item.name.slice(0, 256), type: "project" }]
      } catch {
        return []
      }
    })
  }

  async configure(selection: ProviderConfigurationSelection, signal?: AbortSignal) {
    if (selection.resource_type !== "project") throw new LibTvInputError("LibTV configuration requires a project")
    if (!this.#configuration.write) throw new LibTvInputError("the configured LibTV configuration source is read-only")
    const id = projectUuid(selection.resource_id)
    const project = (await this.listResources({ ...(signal ? { signal } : {}), type: "project" })).find(item => item.id === id)
    if (!project) throw new LibTvInputError("LibTV project is not available to the current account")
    await this.#configuration.write({ project })
    return { configured: true, resource: project, state: "configuration_valid", verified_at: new Date().toISOString() } as const
  }

  async clearConfiguration() {
    if (!this.#configuration.clear) throw new LibTvInputError("the configured LibTV configuration source is read-only")
    await this.#configuration.clear()
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
        let publicSchema: ReturnType<typeof publicModelSchema> = {}
        try {
          const detail = parseJson((await this.#runner.run(["model", match.modelKey], options.signal)).stdout, "model schema") as ModelSchema
          publicSchema = publicModelSchema(detail.schema?.properties)
        } catch {
          // Catalog discovery remains usable when one model detail is unavailable.
        }
        models.push({
          capabilities: {
            authorization: ["oauth"],
            ...(publicSchema.constraints ? { constraints: publicSchema.constraints } : {}),
            output_media_types: kind === "image"
              ? ["image/gif", "image/jpeg", "image/png", "image/webp"]
              : ["video/mp4", "video/quicktime", "video/webm"],
            references: {},
          },
          description: match.description ?? `${match.modelName} on LibTV.`,
          id: `libtv/${match.modelKey}`,
          kind,
          name: match.modelName,
          provider: "libtv",
          ...(publicSchema.provider_options_schema ? { provider_options_schema: publicSchema.provider_options_schema } : {}),
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
    const configured = await this.#configuration.read()
    const targetProject = projectUuid(providerOptions.project_uuid ?? configured.project?.id)
    await this.#runner.run(["account", "info"], signal)
    const availableProjects = await this.listResources({ ...(signal ? { signal } : {}), type: "project" })
    if (!availableProjects.some(item => item.id === targetProject)) {
      throw new LibTvInputError("LibTV project is not available to the current account")
    }
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
