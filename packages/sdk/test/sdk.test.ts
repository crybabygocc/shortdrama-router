import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import {
  createRouterHttpHandler,
  createShortDramaRouter,
  jimengManagedCliPath,
  libtvManagedCliPath,
  MemoryXiaoYunqueCredentials,
  type LibTvCommandRunner,
} from "../src/index.js"

function response(data: Record<string, unknown>, status = 200) {
  return Response.json(data, { status })
}

test("binds built-in providers to one explicit root and rejects unverified executables", { skip: process.platform === "win32" }, async () => {
  const runtimeRootDir = await mkdtemp(path.join(tmpdir(), "shortdrama-router-root-"))
  try {
    const jimengCli = jimengManagedCliPath(runtimeRootDir)
    const libtvCli = libtvManagedCliPath(runtimeRootDir)
    await mkdir(path.dirname(jimengCli), { recursive: true })
    await mkdir(path.dirname(libtvCli), { recursive: true })
    await writeFile(jimengCli, "#!/bin/sh\nprintf '{\"version\":\"managed-test\"}\\n'\n", { mode: 0o755 })
    await writeFile(libtvCli, "#!/bin/sh\nprintf '1.0.2\\n'\n", { mode: 0o755 })

    const providers = await createShortDramaRouter({ runtimeRootDir }).listProviders({
      probeDependencies: true,
    })
    const jimeng = providers.find(provider => provider.id === "jimeng")
    const libtv = providers.find(provider => provider.id === "libtv")
    assert.equal(jimeng?.dependency_statuses?.[0]?.available, true)
    assert.equal(jimeng?.dependency_statuses?.[0]?.compatible, false)
    assert.equal(jimeng?.dependency_statuses?.[0]?.reason_code, "runtime_integrity_failed")
    assert.equal(libtv?.dependency_statuses?.[0]?.available, true)
    assert.equal(libtv?.dependency_statuses?.[0]?.compatible, false)
    assert.equal(libtv?.dependency_statuses?.[0]?.reason_code, "runtime_integrity_failed")
  } finally {
    await rm(runtimeRootDir, { force: true, recursive: true })
  }
})

test("the aggregate package installs all built-in providers before authorization", async () => {
  const router = createShortDramaRouter()
  const providers = await router.listProviders()
  assert.deepEqual(providers.map(provider => provider.id), ["jimeng", "libtv", "xiaoyunque"])
  assert.equal(providers.find(provider => provider.id === "xiaoyunque")?.authorization.state, "not_configured")
  assert.ok((await router.listProviderModels("xiaoyunque")).length > 0)
})

test("exposes LibTV managed Web OAuth through the public HTTP API", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "shortdrama-libtv-http-auth-"))
  let finish!: (result: { stdout: string }) => void
  const completed = new Promise<{ stdout: string }>(resolve => {
    finish = resolve
  })
  const runner: LibTvCommandRunner = {
    async beginWebAuthorization() {
      return {
        cancel() {},
        completed,
        login_url: "https://www.liblib.tv/zh?callback_url=http%3A%2F%2F127.0.0.1%3A5003%2Fcallback",
      }
    },
    async run(args) {
      if (args[0] === "account") return { stdout: JSON.stringify({ user: { id: 1 } }) }
      throw new Error(`unexpected command: ${args.join(" ")}`)
    },
  }
  try {
    const router = createShortDramaRouter({
      jimeng: false,
      libtv: { configDir, randomId: () => "libtv-http-auth", runner },
      xiaoyunque: false,
    })
    const handle = createRouterHttpHandler(router)
    const started = await handle(new Request("http://router.local/api/v1/providers/libtv/authorization", {
      body: JSON.stringify({ method: "oauth" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }))
    assert.equal(started.status, 201)
    const request = await started.json() as { authorization_id: string; login_url: string }
    assert.equal(request.authorization_id, "libtv-http-auth")
    assert.match(request.login_url, /^https:\/\/www\.liblib\.tv\/zh\?/u)
    const pending = await handle(new Request("http://router.local/api/v1/providers/libtv/authorization?probe=true"))
    assert.equal((await pending.json() as { state: string }).state, "pending")

    await writeFile(path.join(configDir, "credentials.json"), "{}")
    finish({ stdout: path.join(configDir, "credentials.json") })
    await new Promise(resolve => setImmediate(resolve))
    const finished = await handle(new Request("http://router.local/api/v1/providers/libtv/authorization", {
      body: JSON.stringify({ authorization_id: request.authorization_id, method: "oauth" }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    }))
    assert.equal(finished.status, 200)
    assert.equal((await finished.json() as { state: string }).state, "valid")
  } finally {
    await rm(configDir, { force: true, recursive: true })
  }
})

test("completes XiaoYunque Access Key enrollment through the public HTTP API", async () => {
  const credentials = new MemoryXiaoYunqueCredentials()
  const router = createShortDramaRouter({
    xiaoyunque: {
      baseUrl: "http://127.0.0.1:8787",
      credentials,
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith("/user/generate_ak")) {
          assert.equal(new Headers(init?.headers).get("cookie"), "sessionid_pippitcn_web=one-time-session")
          return response({ ret: 0, data: { ak: "ak-from-browser-authorization", token_id: "token-1" } })
        }
        if (url.pathname.endsWith("/skill/get_thread")) {
          assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ak-from-browser-authorization")
          return response({ ret: 0, data: { thread: { run_list: [] } } })
        }
        throw new Error(`unexpected path ${url.pathname}`)
      },
      now: () => new Date("2026-08-05T00:00:00.000Z"),
    },
  })
  const handle = createRouterHttpHandler(router)
  const begin = () => handle(new Request("http://router.local/api/v1/providers/xiaoyunque/authorization", {
    body: JSON.stringify({ method: "api_key" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }))
  const first = await begin()
  const firstRequest = await first.json() as { authorization_id: string }
  const second = await begin()
  const secondRequest = await second.json() as {
    authorization_id: string
    cookie_names: string[]
    cookie_origin: string
    login_url: string
  }
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.notEqual(firstRequest.authorization_id, secondRequest.authorization_id)
  assert.equal(secondRequest.cookie_origin, "https://xyq.jianying.com")
  assert.equal(secondRequest.login_url, "https://xyq.jianying.com/login?redirect_url=%2F")
  assert.deepEqual(secondRequest.cookie_names, ["sessionid_pippitcn_web", "sessionid_ss_pippitcn_web"])

  const completed = await handle(new Request("http://router.local/api/v1/providers/xiaoyunque/authorization", {
    body: JSON.stringify({
      authorization_id: secondRequest.authorization_id,
      cookie_origin: secondRequest.cookie_origin,
      cookies: [{ name: "sessionid_pippitcn_web", value: "one-time-session" }],
      method: "api_key",
    }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  }))
  assert.equal(completed.status, 200)
  assert.equal(completed.headers.get("cache-control"), "no-store")
  assert.equal((await completed.json() as { state: string }).state, "valid")
  const stored = await credentials.read()
  assert.equal(stored.access_key, "ak-from-browser-authorization")
  assert.equal(stored.web_session, undefined)

  const status = await handle(new Request("http://router.local/api/v1/providers/xiaoyunque/authorization"))
  assert.equal((await status.json() as { method: string }).method, "api_key")
})
