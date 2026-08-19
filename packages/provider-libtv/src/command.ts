import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  LibTvAuthenticationError,
  LibTvUnavailableError,
  LibTvUpstreamError,
} from "./errors.js"
import { libtvManagedCliPath } from "./runtime.js"

export interface LibTvCommandResult {
  readonly stderr?: string
  readonly stdout: string
}

export interface LibTvCommandRunner {
  run(args: readonly string[], signal?: AbortSignal): Promise<LibTvCommandResult>
}

export interface LibTvProcessRunnerOptions {
  readonly cliPath?: string
  readonly maxOutputBytes?: number
  readonly timeoutMs?: number
}

function defaultCliPath() {
  const managed = libtvManagedCliPath()
  if (existsSync(managed)) return managed
  const installed = path.join(homedir(), ".libtv", "libtv")
  return existsSync(installed) ? installed : managed
}

function commandFailure(output: string) {
  if (/未登录|登录|凭据|credentials?|unauthori[sz]ed/iu.test(output)) {
    return new LibTvAuthenticationError()
  }
  return new LibTvUpstreamError()
}

export class LibTvProcessRunner implements LibTvCommandRunner {
  readonly #cliPath: string
  readonly #maxOutputBytes: number
  readonly #timeoutMs: number

  constructor(options: LibTvProcessRunnerOptions = {}) {
    if (options.cliPath !== undefined && !path.isAbsolute(options.cliPath)) {
      throw new Error("LibTV CLI path must be absolute")
    }
    this.#cliPath = options.cliPath ?? defaultCliPath()
    this.#maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024
    this.#timeoutMs = options.timeoutMs ?? 30 * 60_000
  }

  run(args: readonly string[], signal?: AbortSignal) {
    return new Promise<LibTvCommandResult>((resolve, reject) => {
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
