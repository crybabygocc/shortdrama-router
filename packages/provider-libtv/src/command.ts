import { spawn } from "node:child_process"
import path from "node:path"
import { RuntimeUnavailableError, verifyManagedRuntimeIntegrity } from "@shortdrama-router/runtime"
import {
  LibTvAuthenticationError,
  LibTvUnavailableError,
  LibTvUpstreamError,
} from "./errors.js"
import { libtvManagedCliPath, libtvRuntimeDefinition } from "./runtime.js"

export interface LibTvCommandResult {
  readonly stderr?: string
  readonly stdout: string
}

export interface LibTvWebAuthorizationSession {
  readonly completed: Promise<LibTvCommandResult>
  readonly login_url: string
  cancel(): void
}

export interface LibTvCommandRunner {
  beginWebAuthorization?(signal?: AbortSignal): Promise<LibTvWebAuthorizationSession>
  run(args: readonly string[], signal?: AbortSignal): Promise<LibTvCommandResult>
}

export interface LibTvProcessRunnerOptions {
  readonly cliPath?: string
  readonly configDir?: string
  readonly maxOutputBytes?: number
  readonly runtimeRootDir?: string
  readonly timeoutMs?: number
}

function commandFailure(output: string) {
  if (/未登录|登录|凭据|credentials?|unauthori[sz]ed/iu.test(output)) {
    return new LibTvAuthenticationError()
  }
  return new LibTvUpstreamError()
}

function loginUrl(output: string) {
  for (const match of output.matchAll(/https:\/\/[^\s]+/gu)) {
    if (match[0].length > 8192) continue
    try {
      const url = new URL(match[0])
      const hostname = url.hostname.toLowerCase()
      const callbackValue = url.searchParams.get("callback_url")
      const callback = callbackValue === null ? undefined : new URL(callbackValue)
      if (
        !url.username
        && !url.password
        && callback?.protocol === "http:"
        && !callback.username
        && !callback.password
        && (callback.hostname === "127.0.0.1" || callback.hostname === "::1" || callback.hostname === "localhost")
        && (hostname === "liblib.tv" || hostname.endsWith(".liblib.tv") || hostname === "liblib.art" || hostname.endsWith(".liblib.art"))
      ) return url.toString()
    } catch {
      // Keep scanning output until the CLI prints a complete official URL.
    }
  }
  return undefined
}

export class LibTvProcessRunner implements LibTvCommandRunner {
  readonly #cliPath: string
  readonly #configDir: string | undefined
  readonly #maxOutputBytes: number
  readonly #runtimeRootDir: string | undefined
  readonly #timeoutMs: number
  readonly #verifyManagedRuntime: boolean

  constructor(options: LibTvProcessRunnerOptions = {}) {
    if (options.cliPath !== undefined && !path.isAbsolute(options.cliPath)) {
      throw new Error("LibTV CLI path must be absolute")
    }
    this.#cliPath = options.cliPath ?? libtvManagedCliPath(options.runtimeRootDir)
    this.#configDir = options.configDir
    this.#maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024
    this.#runtimeRootDir = options.runtimeRootDir
    this.#timeoutMs = options.timeoutMs ?? 30 * 60_000
    this.#verifyManagedRuntime = options.cliPath === undefined
  }

  async #verify(signal?: AbortSignal) {
    if (!this.#verifyManagedRuntime) return
    try {
      await verifyManagedRuntimeIntegrity(libtvRuntimeDefinition, {
        ...(this.#runtimeRootDir === undefined ? {} : { rootDir: this.#runtimeRootDir }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (error instanceof RuntimeUnavailableError) throw new LibTvUnavailableError()
      throw error
    }
  }

  #environment() {
    return this.#configDir === undefined
      ? process.env
      : { ...process.env, LIBTV_CONFIG_DIR: this.#configDir }
  }

  async beginWebAuthorization(signal?: AbortSignal): Promise<LibTvWebAuthorizationSession> {
    await this.#verify(signal)
    if (signal?.aborted) throw signal.reason
    const child = spawn(this.#cliPath, ["login", "web"], {
      env: this.#environment(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    let outputBytes = 0
    let stderr = ""
    let stdout = ""
    let startSettled = false
    let resolveStart!: (session: LibTvWebAuthorizationSession) => void
    let rejectStart!: (error: unknown) => void
    let resolveCompleted!: (result: LibTvCommandResult) => void
    let rejectCompleted!: (error: unknown) => void
    const completed = new Promise<LibTvCommandResult>((resolve, reject) => {
      resolveCompleted = resolve
      rejectCompleted = reject
    })
    void completed.catch(() => {})
    const started = new Promise<LibTvWebAuthorizationSession>((resolve, reject) => {
      resolveStart = resolve
      rejectStart = reject
    })
    const cancel = () => child.kill("SIGTERM")
    const fail = (error: unknown) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (!startSettled) {
        startSettled = true
        rejectStart(error)
      }
      rejectCompleted(error)
    }
    const expose = () => {
      if (startSettled) return
      const url = loginUrl(`${stdout}\n${stderr}`)
      if (!url) return
      startSettled = true
      signal?.removeEventListener("abort", onAbort)
      resolveStart({ cancel, completed, login_url: url })
    }
    const append = (target: "stderr" | "stdout", chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > this.#maxOutputBytes) {
        cancel()
        fail(new LibTvUpstreamError("LibTV CLI returned too much login output"))
        return
      }
      if (target === "stdout") stdout += chunk.toString("utf8")
      else stderr += chunk.toString("utf8")
      expose()
    }
    const onAbort = () => {
      cancel()
      fail(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      cancel()
      fail(new LibTvUpstreamError("LibTV CLI web login timed out"))
    }, this.#timeoutMs)
    signal?.addEventListener("abort", onAbort, { once: true })
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk))
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk))
    child.once("error", error => {
      fail((error as NodeJS.ErrnoException).code === "ENOENT"
        ? new LibTvUnavailableError()
        : new LibTvUpstreamError("LibTV CLI web login could not be started"))
    })
    child.once("close", code => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (code === 0) {
        if (!startSettled) {
          startSettled = true
          rejectStart(new LibTvUpstreamError("LibTV CLI web login returned no login URL"))
        }
        resolveCompleted({ stderr, stdout })
        return
      }
      fail(commandFailure(`${stdout}\n${stderr}`))
    })
    return started
  }

  async run(args: readonly string[], signal?: AbortSignal) {
    await this.#verify(signal)
    return new Promise<LibTvCommandResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      const child = spawn(this.#cliPath, [...args], {
        env: this.#environment(),
        stdio: ["ignore", "pipe", "pipe"],
      })
      let settled = false
      let stdout = ""
      let stderr = ""
      let outputBytes = 0
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        if (error !== undefined) reject(error)
        else resolve({ stderr, stdout })
      }
      const append = (target: "stderr" | "stdout", chunk: Buffer) => {
        outputBytes += chunk.byteLength
        if (outputBytes > this.#maxOutputBytes) {
          child.kill("SIGTERM")
          finish(new LibTvUpstreamError("LibTV CLI returned too much output"))
          return
        }
        if (target === "stdout") stdout += chunk.toString("utf8")
        else stderr += chunk.toString("utf8")
      }
      const onAbort = () => {
        child.kill("SIGTERM")
        finish(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
      }
      const timer = setTimeout(() => {
        child.kill("SIGTERM")
        finish(new LibTvUpstreamError("LibTV CLI command timed out"))
      }, this.#timeoutMs)
      signal?.addEventListener("abort", onAbort, { once: true })
      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk))
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk))
      child.once("error", error => {
        finish((error as NodeJS.ErrnoException).code === "ENOENT"
          ? new LibTvUnavailableError()
          : new LibTvUpstreamError())
      })
      child.once("close", code => {
        if (settled) return
        if (code === 0) finish()
        else finish(commandFailure(`${stdout}\n${stderr}`))
      })
    })
  }
}
