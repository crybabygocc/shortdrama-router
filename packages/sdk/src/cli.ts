#!/usr/bin/env node

import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type {
  ProviderDescriptor,
  ShortDramaRouter,
} from "@shortdrama-router/core"
import { createShortDramaRouter } from "./index.js"
import {
  startRouterServer,
  type RouterServerOptions,
  type RunningRouterServer,
} from "./server.js"

export interface CliIo {
  readonly error: (value: string) => void
  readonly output: (value: string) => void
}

export interface CliOptions {
  readonly io?: CliIo
  readonly router?: ShortDramaRouter
  readonly startServer?: (options: RouterServerOptions) => Promise<RunningRouterServer>
}

function authorizationLabel(provider: ProviderDescriptor) {
  const method = provider.authorization.method ?? "-"
  return `${provider.authorization.state} (${method})`
}

function pad(value: string, width: number) {
  return value.padEnd(width, " ")
}

export function formatProviderTable(providers: readonly ProviderDescriptor[]) {
  const rows = providers.map(provider => [
    provider.id,
    provider.name,
    authorizationLabel(provider),
  ])
  const headers = ["SERVICE", "NAME", "AUTHORIZATION"]
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map(row => row[index]?.length ?? 0),
  ))
  return [headers, ...rows]
    .map(row => row.map((value, index) => pad(value ?? "", widths[index] ?? 0)).join("  ").trimEnd())
    .join("\n")
}

function usage() {
  return [
    "Usage:",
    "  shortdrama-router providers [--probe] [--json]",
    "  shortdrama-router serve [--host HOST] [--port PORT]",
    "",
    "Commands:",
    "  providers   List installed services and their authorization status.",
    "  serve       Start the local HTTP API server.",
    "",
    "Options:",
    "  --probe     Verify configured credentials with each provider.",
    "  --json      Print machine-readable JSON.",
    "  --host      Bind host; defaults to 127.0.0.1.",
    "  --port      Bind port; defaults to 8080.",
  ].join("\n")
}

function valueAfter(args: readonly string[], name: string) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

export async function runCli(args: readonly string[], options: CliOptions = {}) {
  const io = options.io ?? {
    error: value => process.stderr.write(`${value}\n`),
    output: value => process.stdout.write(`${value}\n`),
  }
  const command = args[0] ?? "providers"
  if (command === "help" || command === "--help" || command === "-h") {
    io.output(usage())
    return 0
  }
  if (command !== "providers" && command !== "serve") {
    io.error(`Unknown command: ${command}\n\n${usage()}`)
    return 2
  }
  if (command === "serve") {
    const flags = args.slice(1)
    const unknown = flags.find((flag, index) => flag.startsWith("--")
      ? flag !== "--host" && flag !== "--port"
      : index === 0 || (flags[index - 1] !== "--host" && flags[index - 1] !== "--port"))
    if (unknown) {
      io.error(`Unknown option: ${unknown}\n\n${usage()}`)
      return 2
    }
    let host: string | undefined
    let port: number | undefined
    try {
      host = valueAfter(flags, "--host")
      const rawPort = valueAfter(flags, "--port")
      port = rawPort === undefined ? undefined : Number(rawPort)
      if (port !== undefined && (!Number.isSafeInteger(port) || port < 1 || port > 65_535)) {
        throw new Error("--port must be an integer from 1 to 65535")
      }
    } catch (error) {
      io.error(`${error instanceof Error ? error.message : "invalid serve options"}\n\n${usage()}`)
      return 2
    }
    const start = options.startServer ?? startRouterServer
    const accessKey = process.env.XYQ_ACCESS_KEY ?? process.env.XIAOYUNQUE_ACCESS_KEY
    const routerKey = process.env.SHORTDRAMA_ROUTER_KEY
    const server = await start({
      ...(accessKey === undefined ? {} : { accessKey }),
      ...(host === undefined ? {} : { host }),
      ...(port === undefined ? {} : { port }),
      ...(routerKey === undefined ? {} : { routerKey }),
    })
    io.output(`shortdrama-router listening on ${server.url}`)
    await server.finished
    return 0
  }
  const supported = new Set(["--json", "--probe"])
  const flags = args.slice(1)
  const unknown = flags.find(flag => !supported.has(flag))
  if (unknown) {
    io.error(`Unknown option: ${unknown}\n\n${usage()}`)
    return 2
  }
  const router = options.router ?? createShortDramaRouter({
    xiaoyunque: {
      accessKey: process.env.XYQ_ACCESS_KEY ?? process.env.XIAOYUNQUE_ACCESS_KEY,
    },
  })
  const providers = await router.listProviders({ probeAuthorization: flags.includes("--probe") })
  io.output(flags.includes("--json")
    ? JSON.stringify({ data: providers }, null, 2)
    : formatProviderTable(providers))
  return 0
}

export function isCliEntry(entry: string | undefined, moduleUrl = import.meta.url): boolean {
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}

const entry = process.argv[1]
if (isCliEntry(entry)) {
  process.exitCode = await runCli(process.argv.slice(2))
}
