import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  JimengAuthenticationError,
  JimengPlanError,
  JimengUnavailableError,
  JimengUpstreamError,
} from "./errors.js"

export interface JimengCommandResult {
  readonly stdout: string
}

export interface JimengCommandRunner {
  run(args: readonly string[], signal?: AbortSignal): Promise<JimengCommandResult>
}

export interface JimengProcessRunnerOptions {
  readonly cliPath?: string
  readonly maxOutputBytes?: number
  readonly timeoutMs?: number
}

function defaultCliPath() {
  const installed = path.join(homedir(), ".local", "bin", "dreamina")
  return existsSync(installed) ? installed : "dreamina"
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
  readonly #timeoutMs: number

  constructor(options: JimengProcessRunnerOptions = {}) {
    this.#cliPath = options.cliPath ?? defaultCliPath()
    this.#maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024
    this.#timeoutMs = options.timeoutMs ?? 30 * 60_000
  }

  run(args: readonly string[], signal?: AbortSignal) {
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
