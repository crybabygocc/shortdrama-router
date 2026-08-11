import assert from "node:assert/strict"
import test from "node:test"
import {
  ShortDramaRouter,
  type ProviderAdapter,
  type ProviderAuthorizationStatus,
} from "../src/index.js"

const authorization: ProviderAuthorizationStatus = {
  authorized: true,
  configured: true,
  method: "api_key",
  state: "valid",
}

function provider(): ProviderAdapter {
  return {
    metadata: {
      capabilities: {
        authorization: ["api_key"],
        generation: ["audio", "image", "video"],
        models: true,
        usage: false,
      },
      description: "Test provider",
      id: "test-provider",
      name: "Test Provider",
    },
    async createVideo() {
      return { reference: { remote_id: "remote-1" }, status: "queued" }
    },
    async createAudio() {
      return { reference: { remote_id: "remote-audio-1" }, status: "queued" }
    },
    async createImage() {
      return { reference: { remote_id: "remote-image-1" }, status: "queued" }
    },
    async getAuthorizationStatus() {
      return authorization
    },
    async getVideo(reference) {
      return {
        outputs: [{ url: "https://media.example/video.mp4" }],
        reference,
        status: "completed",
      }
    },
    async getAudio(reference) {
      return {
        outputs: [{ content_type: "audio/mpeg", url: "https://media.example/speech.mp3" }],
        reference,
        status: "completed",
      }
    },
    async getImage(reference) {
      return {
        outputs: [{ url: "https://media.example/image.png" }],
        reference,
        status: "completed",
      }
    },
    async listModels() {
      return [{
        capabilities: {},
        description: "Test model",
        id: "test-provider/video-1",
        kind: "video",
        name: "Video 1",
        provider: "test-provider",
      }]
    },
  }
}

test("discovers providers and lists models only within one provider", async () => {
  const router = new ShortDramaRouter({ providers: [provider()] })
  assert.equal((await router.listProviders())[0]?.authorization.state, "valid")
  assert.deepEqual((await router.listProviderModels("test-provider")).map(model => model.id), [
    "test-provider/video-1",
  ])
  assert.equal("listModels" in router, false)
})

test("routes video creation and polling behind a router-owned job id", async () => {
  const router = new ShortDramaRouter({
    providers: [provider()],
    randomId: () => "job-1",
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  })
  const created = await router.createVideo({
    model: "test-provider/video-1",
    prompt: "A short scene",
  })
  assert.equal(created.id, "job-1")
  assert.equal(created.status, "queued")
  const completed = await router.getVideo(created.id)
  assert.equal(completed.status, "completed")
  assert.equal(completed.outputs?.[0]?.url, "https://media.example/video.mp4")
})

test("routes image creation and polling behind a router-owned job id", async () => {
  let sequence = 0
  const router = new ShortDramaRouter({
    providers: [provider()],
    randomId: () => `job-${++sequence}`,
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  })
  const created = await router.createImage({
    model: "test-provider/image-1",
    n: 1,
    prompt: "A storyboard frame",
  })
  assert.equal(created.id, "job-1")
  assert.equal(created.status, "queued")
  const completed = await router.getImage(created.id)
  assert.equal(completed.status, "completed")
  assert.equal(completed.outputs?.[0]?.url, "https://media.example/image.png")
})

test("routes audio creation and polling behind a router-owned job id", async () => {
  let sequence = 0
  const router = new ShortDramaRouter({
    providers: [provider()],
    randomId: () => `audio-job-${++sequence}`,
    now: () => new Date("2026-08-11T00:00:00.000Z"),
  })
  const created = await router.createAudio({
    model: "test-provider/audio-1",
    prompt: "Three seconds of glass wind chimes",
  })
  assert.equal(created.id, "audio-job-1")
  assert.equal(created.status, "queued")
  const completed = await router.getAudio(created.id)
  assert.equal(completed.status, "completed")
  assert.equal(completed.outputs?.[0]?.url, "https://media.example/speech.mp3")
})
