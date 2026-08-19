import { spawn } from "node:child_process"
import path from "node:path"
import { RuntimeUnavailableError, verifyManagedRuntimeIntegrity } from "@shortdrama-router/runtime"
import {
  JimengAuthenticationError,
  JimengPlanError,
  JimengUnavailableError,
  JimengUpstreamError,
} from "./errors.js"
import { jimengManagedCliPath, jimengRuntimeDefinition } from "./runtime.js"

export interface JimengCommandResult {
  readonly stdout: string
}

export interface JimengCommandRunner {
  run(args: readonly string[], signal?: AbortSignal): Promise<JimengCommandResult>
}

export interface JimengProcessRunnerOptions {
  readonly cliPath?: string
  readonly maxOutputBytes?: number
  readonly runtimeRootDir?: string
  readonly timeoutMs?: number
}

function commandFailure(output: string) {
  if (/没有 dreamina_cli 使用权限|仅限高级/iu.test(output)) return new JimengPlanError()
  if (/未检测到有效登录态|请先执行 dreamina login|unauthori[sz]ed/iu.test(output)) {
    return new JimengAuthenticationError()
  }
  return new JimengUpstreamError()
}

export class JimengProcessRunner implements JimengCommandRunner {
  readonly #cliPath: string
  readonly #maxOutputBytes: number
  readonly #runtimeRootDir: string | undefined
  readonly #timeoutMs: number
  readonly #verifyManagedRuntime: boolean

  constructor(options: JimengProcessRunnerOptions = {}) {
    if (options.cliPath !== undefined && !path.isAbsolute(options.cliPath)) {
      throw new Error("Dreamina CLI path must be absolute")
    }
    this.#cliPath = options.cliPath ?? jimengManagedCliPath(options.runtimeRootDir)
    this.#maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024
    this.#runtimeRootDir = options.runtimeRootDir
    this.#timeoutMs = options.timeoutMs ?? 30 * 60_000
    this.#verifyManagedRuntime = options.cliPath === undefined
  }

  async run(args: readonly string[], signal?: AbortSignal) {
    if (this.#verifyManagedRuntime) {
      try {
        await verifyManagedRuntimeIntegrity(jimengRuntimeDefinition, {
          ...(this.#runtimeRootDir === undefined ? {} : { rootDir: this.#runtimeRootDir }),
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        if (error instanceof RuntimeUnavailableError) throw new JimengUnavailableError()
        throw error
      }
    }
    return new Promise<JimengCommandResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      const child = spawn(this.#cliPath, [...args], {
        env: process.env,
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
        else resolve({ stdout })
      }
      const append = (target: "stderr" | "stdout", chunk: Buffer) => {
        outputBytes += chunk.byteLength
        if (outputBytes > this.#maxOutputBytes) {
          child.kill("SIGTERM")
          finish(new JimengUpstreamError("Dreamina CLI returned too much output"))
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
        finish(new JimengUpstreamError("Dreamina CLI command timed out"))
      }, this.#timeoutMs)
      signal?.addEventListener("abort", onAbort, { once: true })
      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk))
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk))
      child.once("error", error => {
        finish((error as NodeJS.ErrnoException).code === "ENOENT"
          ? new JimengUnavailableError()
          : new JimengUpstreamError())
      })
      child.once("close", code => {
        if (settled) return
        if (code === 0) finish()
        else finish(commandFailure(`${stdout}\n${stderr}`))
      })
    })
  }
}
