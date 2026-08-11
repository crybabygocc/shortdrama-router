import assert from "node:assert/strict"
import test from "node:test"
import {
  MemoryXiaoYunqueCredentials,
  XiaoYunqueProvider,
} from "../src/index.js"

function response(data: Record<string, unknown>, status = 200) {
  return Response.json(data, { status })
}

test("prefers an official Access Key and maps create/poll to normalized jobs", async () => {
  const calls: Array<{ body?: Record<string, unknown>; path: string }> = []
  const provider = new XiaoYunqueProvider({
    accessKey: "ak-test",
    baseUrl: "http://127.0.0.1:8787",
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined
      calls.push({ ...(body === undefined ? {} : { body }), path: url.pathname })
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ak-test")
      if (url.pathname.endsWith("/skill/get_thread")) return response({ ret: 0, data: { thread: { run_list: [] } } })
      if (url.pathname.endsWith("/skill/submit_run")) {
        return response({ ret: 0, data: { run: { run_id: "run-1", thread_id: "thread-1", state: 1 } } })
      }
      if (url.pathname.endsWith("/agent/query_generate_video_result")) {
        return response({ ret: 0, data: { run_state: 3, video_urls: ["http://127.0.0.1:8787/video.mp4"] } })
      }
      throw new Error(`unexpected path ${url.pathname}`)
    },
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  })

  assert.equal((await provider.getAuthorizationStatus({ probe: true })).state, "valid")
  const created = await provider.createVideo({
    model: "xiaoyunque/seedance-2.5",
    prompt: "A short scene",
  })
  assert.equal(created.status, "queued")
  assert.equal(created.reference.transport, "api_key")
  const submit = calls.find(call => call.path.endsWith("/skill/submit_run"))?.body
  assert.equal(submit?.agent_name, "pippit_video_part_agent")
  const completed = await provider.getVideo(created.reference)
  assert.equal(completed.status, "completed")
  assert.equal(completed.outputs?.[0]?.url, "http://127.0.0.1:8787/video.mp4")
})

test("maps image generation to the official Nest Agent and returns image outputs", async () => {
  let submitted: Record<string, unknown> | undefined
  const provider = new XiaoYunqueProvider({
    accessKey: "ak-image-test",
    baseUrl: "http://127.0.0.1:8787",
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ak-image-test")
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (url.pathname.endsWith("/skill/submit_run")) {
        submitted = body
        return response({ ret: "0", data: { run: { run_id: "image-run-1", thread_id: "image-thread-1", state: 1 } } })
      }
      if (url.pathname.endsWith("/skill/get_thread")) {
        assert.deepEqual(body, { run_id: "image-run-1", thread_id: "image-thread-1" })
        return response({
          ret: "0",
          data: {
            thread: {
              run_list: [{
                entry_list: [{
                  artifact: {
                    content: [{
                      data: JSON.stringify({ image: { url: "http://127.0.0.1:8787/generated.png" } }),
                      sub_type: "biz/x_data_image",
                    }],
                  },
                }],
                run_id: "image-run-1",
                state: 3,
              }],
            },
          },
        })
      }
      throw new Error(`unexpected path ${url.pathname}`)
    },
  })

  const created = await provider.createImage({
    aspect_ratio: "1:1",
    input_references: [{ pippit_asset_id: "image-asset-1" }],
    model: "xiaoyunque/seedream-4.5",
    n: 2,
    prompt: "Two storyboard frames",
  })
  assert.equal(created.status, "queued")
  assert.equal(submitted?.agent_name, "pippit_nest_agent")
  assert.deepEqual(submitted?.asset_ids, ["image-asset-1"])
  assert.deepEqual(submitted?.general_agent_settings, {
    generate_image_count: 2,
    image_model: "seedream_4.5",
    ratio: 6,
  })
  const completed = await provider.getImage(created.reference)
  assert.equal(completed.status, "completed")
  assert.equal(completed.outputs?.[0]?.url, "http://127.0.0.1:8787/generated.png")
})

test("rejects Mini Lite resolutions that XiaoYunque silently coerces", async () => {
  const provider = new XiaoYunqueProvider({ accessKey: "ak-test", baseUrl: "http://127.0.0.1:8787" })
  await assert.rejects(
    provider.createVideo({
      model: "xiaoyunque/seedance-2.0-mini-lite",
      prompt: "A short scene",
      resolution: "480p",
    }),
    /does not support resolution 480p/,
  )
})

test("reports an invalid Access Key as expired after a live probe", async () => {
  const provider = new XiaoYunqueProvider({
    accessKey: "ak-expired",
    baseUrl: "http://127.0.0.1:8787",
    fetch: async () => response({ ret: 1015, data: {} }, 401),
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  })
  const result = await provider.getAuthorizationStatus({ probe: true })
  assert.equal(result.state, "expired")
  assert.equal(result.authorized, false)
})

test("accepts XiaoYunque's missing probe thread response as proof of a valid Access Key", async () => {
  const provider = new XiaoYunqueProvider({
    accessKey: "ak-valid",
    baseUrl: "http://127.0.0.1:8787",
    fetch: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ak-valid")
      return response({ ret: "5", errmsg: "thread not found" })
    },
  })
  const result = await provider.getAuthorizationStatus({ probe: true })
  assert.equal(result.state, "valid")
  assert.equal(result.authorized, true)
})

test("treats XiaoYunque's missing Access Key record response as expired", async () => {
  const provider = new XiaoYunqueProvider({
    accessKey: "ak-invalid",
    baseUrl: "http://127.0.0.1:8787",
    fetch: async () => response({ ret: "2", errmsg: "Access Key not found" }),
  })
  const result = await provider.getAuthorizationStatus({ probe: true })
  assert.equal(result.state, "expired")
  assert.equal(result.authorized, false)
})

test("creates and stores an Access Key after a user-authorized browser login", async () => {
  const credentials = new MemoryXiaoYunqueCredentials()
  const now = new Date("2026-08-05T00:00:00.000Z")
  const provider = new XiaoYunqueProvider({
    baseUrl: "http://127.0.0.1:8787",
    credentials,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      const headers = new Headers(init?.headers)
      if (url.pathname.endsWith("/user/generate_ak")) {
        assert.equal(headers.get("cookie"), "sessionid_pippitcn_web=temporary-session")
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        assert.equal(body.token_name, "shortdrama-router")
        assert.equal(body.expired_at, Math.floor((now.getTime() + 30 * 24 * 60 * 60_000) / 1_000))
        return response({ ret: 0, data: { ak: "ak-generated", token_id: "token-1" } })
      }
      if (url.pathname.endsWith("/skill/get_thread")) {
        assert.equal(headers.get("authorization"), "Bearer ak-generated")
        return response({ ret: 0, data: { thread: { run_list: [] } } })
      }
      throw new Error(`unexpected path ${url.pathname}`)
    },
    now: () => now,
  })

  const request = await provider.beginAuthorization("api_key")
  assert.equal(request.method, "api_key")
  assert.equal(request.cookie_origin, "https://xyq.jianying.com")
  const status = await provider.completeAuthorization({
    authorization_id: request.authorization_id,
    cookie_origin: "https://xyq.jianying.com",
    cookies: [{ name: "sessionid_pippitcn_web", value: "temporary-session" }],
    method: "api_key",
  })
  assert.equal(status.state, "valid")
  assert.equal(status.method, "api_key")
  assert.equal(status.expires_at, "2026-09-04T00:00:00.000Z")
  assert.deepEqual(await credentials.read(), {
    access_key: "ak-generated",
    access_key_expires_at: "2026-09-04T00:00:00.000Z",
  })
})

test("exposes a local browser-session authorization request", async () => {
  const provider = new XiaoYunqueProvider({ baseUrl: "http://127.0.0.1:8787" })
  const request = await provider.beginAuthorization("browser_session")
  assert.equal(request.cookie_origin, "https://xyq.jianying.com")
  assert.deepEqual(request.cookie_names, [
    "sessionid_pippitcn_web",
    "sessionid_ss_pippitcn_web",
  ])
})

test("stores a Web session only when browser_session is explicitly selected", async () => {
  const credentials = new MemoryXiaoYunqueCredentials()
  const provider = new XiaoYunqueProvider({
    baseUrl: "http://127.0.0.1:8787",
    credentials,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      assert.equal(url.pathname, "/api/biz/v1/common/get_odin_user_info")
      assert.equal(new Headers(init?.headers).get("cookie"), "sessionid_ss_pippitcn_web=local-session")
      return response({ ret: 0, data: { user_id: "user-1" } })
    },
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  })

  const request = await provider.beginAuthorization("browser_session")
  const status = await provider.completeAuthorization({
    authorization_id: request.authorization_id,
    cookie_origin: "https://xyq.jianying.com",
    cookies: [{ name: "sessionid_ss_pippitcn_web", value: "local-session" }],
    method: "browser_session",
  })
  assert.equal(status.state, "valid")
  assert.equal((await credentials.read()).access_key, undefined)
  assert.equal((await credentials.read()).web_session?.cookies[0]?.value, "local-session")
})

test("uses a local Web session when no Access Key is configured", async () => {
  let submittedRunId = ""
  const credentials = new MemoryXiaoYunqueCredentials({
    web_session: {
      authorized_at: "2026-08-05T00:00:00.000Z",
      cookies: [{ name: "sessionid_pippitcn_web", value: "local-session-value" }],
    },
  })
  const provider = new XiaoYunqueProvider({
    baseUrl: "http://127.0.0.1:8787",
    credentials,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      assert.equal(new Headers(init?.headers).get("cookie"), "sessionid_pippitcn_web=local-session-value")
      if (url.pathname.endsWith("/get_odin_user_info")) {
        return response({ ret: 0, data: { user_id: "user-1" } })
      }
      if (url.pathname.endsWith("/get_user_workspace")) {
        return response({ ret: 0, data: { space_id: "space-1", workspace_id: "workspace-1" } })
      }
      if (url.pathname.endsWith("/submit_run")) {
        const body = JSON.parse(String(init?.body)) as { message: { run_id: string } }
        submittedRunId = body.message.run_id
        return response({ ret: 0, data: {} })
      }
      if (url.pathname.endsWith("/get_thread")) {
        return response({
          ret: 0,
          data: {
            thread: {
              run_list: [{
                entry_list: [{
                  artifact: {
                    content: [{
                      data: JSON.stringify({ video: { scene_urls: { download: "http://127.0.0.1:8787/web-video.mp4" } } }),
                      sub_type: "biz/x_data_video",
                    }],
                  },
                }],
                run_id: submittedRunId,
                state: 3,
              }],
            },
          },
        })
      }
      throw new Error(`unexpected path ${url.pathname}`)
    },
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  })
  const created = await provider.createVideo({
    model: "xiaoyunque/seedance-2.0-mini-lite",
    prompt: "A local session scene",
  })
  assert.equal(created.reference.transport, "browser_session")
  const completed = await provider.getVideo(created.reference)
  assert.equal(completed.status, "completed")
  assert.equal(completed.outputs?.[0]?.url, "http://127.0.0.1:8787/web-video.mp4")
})
