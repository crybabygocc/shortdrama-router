import { timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { ShortDramaRouter } from "@shortdrama-router/core"
import { createRouterHttpHandler } from "@shortdrama-router/http"
import { JimengProvider } from "@shortdrama-router/provider-jimeng"
import { LibTvProvider } from "@shortdrama-router/provider-libtv"
import { XiaoYunqueProvider } from "@shortdrama-router/provider-xiaoyunque"

export interface RouterServerOptions {
  readonly accessKey?: string
  readonly host?: string
  readonly jimengCliPath?: string
  readonly libtvCliPath?: string
  readonly libtvProjectUuid?: string
  readonly port?: number
  readonly router?: ShortDramaRouter
  readonly routerKey?: string
}

export interface RunningRouterServer {
  readonly close: () => Promise<void>
  readonly finished: Promise<void>
  readonly url: string
}

function loopbackHost(host: string) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost"
}

function authorized(header: string | null, routerKey: string) {
  const expected = Buffer.from(`Bearer ${routerKey}`)
  const actual = Buffer.from(header ?? "")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function requestFromNode(request: IncomingMessage, baseUrl: string) {
  const method = request.method ?? "GET"
  const headers = new Headers()
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]
    const value = request.rawHeaders[index + 1]
    if (name !== undefined && value !== undefined) headers.append(name, value)
  }
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : Readable.toWeb(request) as ReadableStream<Uint8Array>
  const init: RequestInit & { duplex?: "half" } = {
    headers,
    method,
    ...(body === undefined ? {} : { body, duplex: "half" }),
  }
  return new Request(new URL(request.url ?? "/", baseUrl), init)
}

async function sendNodeResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status
  response.headers.forEach((value, name) => target.setHeader(name, value))
  if (!response.body) {
    target.end()
    return
  }
  await new Promise<void>((resolve, reject) => {
    const source = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
    source.once("error", reject)
    target.once("error", reject)
    target.once("finish", resolve)
    source.pipe(target)
  })
}

export async function startRouterServer(options: RouterServerOptions = {}): Promise<RunningRouterServer> {
  const host = options.host ?? "127.0.0.1"
  const port = options.port ?? 8080
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("server port is invalid")
  if (!loopbackHost(host) && !options.routerKey) {
    throw new Error("SHORTDRAMA_ROUTER_KEY is required when binding outside loopback")
  }
  const router = options.router ?? new ShortDramaRouter({
    providers: [
      new JimengProvider({
        ...(options.jimengCliPath === undefined ? {} : { cliPath: options.jimengCliPath }),
      }),
      new LibTvProvider({
        ...(options.libtvCliPath === undefined ? {} : { cliPath: options.libtvCliPath }),
        ...(options.libtvProjectUuid === undefined ? {} : { projectUuid: options.libtvProjectUuid }),
      }),
      new XiaoYunqueProvider({
        ...(options.accessKey === undefined ? {} : { accessKey: options.accessKey }),
      }),
    ],
  })
  const handle = createRouterHttpHandler(router, {
    ...(options.routerKey === undefined ? {} : {
      authorize: (request) => authorized(request.headers.get("authorization"), options.routerKey!),
    }),
  })
  let baseUrl = `http://${host}:${port}`
  const server = createServer(async (incoming, outgoing) => {
    try {
      await sendNodeResponse(await handle(requestFromNode(incoming, baseUrl)), outgoing)
    } catch {
      if (!outgoing.headersSent) {
        outgoing.statusCode = 500
        outgoing.setHeader("content-type", "application/json")
      }
      outgoing.end(JSON.stringify({ error: { code: "internal_error", message: "shortdrama-router request failed" } }))
    }
  })
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"))
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server address is unavailable")
  const displayHost = address.family === "IPv6" ? `[${address.address}]` : address.address
  baseUrl = `http://${displayHost}:${address.port}`
  const finished = new Promise<void>((resolve, reject) => {
    server.once("close", resolve)
    server.once("error", reject)
  })
  return {
    close: () => new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close(error => error ? reject(error) : resolve())
    }),
    finished,
    url: baseUrl,
  }
}
