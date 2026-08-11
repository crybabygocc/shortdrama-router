import assert from "node:assert/strict"
import test from "node:test"
import {
  ShortDramaRouter,
  type ProviderAdapter,
} from "@shortdrama-router/core"
import { createRouterHttpHandler } from "../src/index.js"

const provider: ProviderAdapter = {
  metadata: {
    capabilities: { authorization: ["api_key"], generation: ["image", "video"], models: true, usage: false },
    description: "Test provider",
    id: "test-provider",
    name: "Test Provider",
  },
  async createVideo() {
    return { reference: { remote: "1" }, status: "queued" }
  },
  async createImage() {
    return { reference: { remote: "image-1" }, status: "queued" }
  },
  async getAuthorizationStatus() {
    return { authorized: true, configured: true, method: "api_key", state: "valid" }
  },
  async getVideo(reference) {
    return { outputs: [{ url: "https://example.com/video.mp4" }], reference, status: "completed" }
  },
  async getImage(reference) {
    return { outputs: [{ url: "https://example.com/image.png" }], reference, status: "completed" }
  },
  async listModels() {
    return [{
      capabilities: {},
      description: "Video model",
      id: "test-provider/video-1",
      kind: "video",
      name: "Video 1",
      provider: "test-provider",
    }]
  },
}

test("serves provider discovery and provider-scoped models without global models", async () => {
  const handle = createRouterHttpHandler(new ShortDramaRouter({ providers: [provider] }))
  const providers = await handle(new Request("http://router.local/api/v1/providers"))
  assert.equal(providers.status, 200)
  assert.equal((await providers.json() as { data: unknown[] }).data.length, 1)

  const models = await handle(new Request("http://router.local/api/v1/providers/test-provider/models"))
  assert.equal(models.status, 200)
  assert.equal((await models.json() as { data: Array<{ id: string }> }).data[0]?.id, "test-provider/video-1")

  const globalModels = await handle(new Request("http://router.local/api/v1/models"))
  assert.equal(globalModels.status, 404)
})

test("creates and polls a video through the Fetch handler", async () => {
  const router = new ShortDramaRouter({ providers: [provider], randomId: () => "job-1" })
  const handle = createRouterHttpHandler(router)
  const created = await handle(new Request("http://router.local/api/v1/videos", {
    body: JSON.stringify({ model: "test-provider/video-1", prompt: "A short scene" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }))
  assert.equal(created.status, 202)
  assert.equal((await created.json() as { id: string }).id, "job-1")
  const completed = await handle(new Request("http://router.local/api/v1/videos/job-1"))
  assert.equal((await completed.json() as { status: string }).status, "completed")
})

test("creates and polls an asynchronous image job", async () => {
  const router = new ShortDramaRouter({ providers: [provider], randomId: () => "image-job-1" })
  const handle = createRouterHttpHandler(router)
  const created = await handle(new Request("http://router.local/api/v1/images", {
    body: JSON.stringify({ model: "test-provider/image-1", prompt: "A storyboard frame" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }))
  assert.equal(created.status, 202)
  assert.equal((await created.json() as { id: string }).id, "image-job-1")
  const completed = await handle(new Request("http://router.local/api/v1/images/image-job-1"))
  assert.equal((await completed.json() as { status: string }).status, "completed")
})

test("waits for an image and returns the OpenAI Images response shape", async () => {
  const router = new ShortDramaRouter({
    providers: [provider],
    randomId: () => "image-job-openai",
    now: () => new Date("2026-08-11T00:00:00.000Z"),
  })
  const handle = createRouterHttpHandler(router, {
    imagePollIntervalMs: 0,
    sleep: async () => undefined,
  })
  const response = await handle(new Request("http://router.local/v1/images/generations", {
    body: JSON.stringify({
      model: "test-provider/image-1",
      prompt: "A storyboard frame",
      response_format: "url",
      size: "1024x1024",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    created: 1_786_406_400,
    data: [{ url: "https://example.com/image.png" }],
  })
})
