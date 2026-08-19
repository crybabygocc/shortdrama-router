import assert from "node:assert/strict"
import test from "node:test"
import {
  ShortDramaRouter,
  RouterError,
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
        outputs: [{ content_type: "video/mp4", url: "https://media.example/video.mp4" }],
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
        outputs: [{ content_type: "image/png", url: "https://media.example/image.png" }],
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

test("does not mark a model available when an executable dependency compatibility is unknown", async () => {
  const base = provider()
  const metadata = {
    ...base.metadata,
    dependencies: [{
      executable: "fixture",
      id: "fixture-cli",
      kind: "executable",
      required: true,
      version_command: ["--version"],
    }],
  }
  const adapter: ProviderAdapter = {
    ...base,
    metadata,
    async getDependencyStatuses() {
      return [{
        ...metadata.dependencies[0]!,
        available: true,
        compatible: null,
        version: "unknown-build",
      }]
    },
  }
  const model = (await new ShortDramaRouter({ providers: [adapter] }).listProviderModels("test-provider", undefined, true))[0]
  assert.equal(model?.availability?.state, "unavailable")
  assert.equal(model?.availability?.reason_code, "dependency_incompatible")
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

test("atomically replays idempotent generation and rejects a conflicting payload", async () => {
  let submissions = 0
  const adapter = provider()
  const originalCreate = adapter.createVideo
  adapter.createVideo = async (request, signal) => {
    submissions += 1
    return originalCreate(request, signal)
  }
  let sequence = 0
  const router = new ShortDramaRouter({ providers: [adapter], randomId: () => `job-${++sequence}` })
  const first = await router.createVideo({
    idempotency_key: "customer-request-1",
    model: "test-provider/video-1",
    prompt: "A short scene",
  })
  const replay = await router.createVideo({
    idempotency_key: "customer-request-1",
    model: "test-provider/video-1",
    prompt: "A short scene",
  })
  assert.equal(replay.id, first.id)
  assert.equal(submissions, 1)
  await assert.rejects(
    router.createVideo({
      idempotency_key: "customer-request-1",
      model: "test-provider/video-1",
      prompt: "A different scene",
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "idempotency_conflict",
  )
})

test("normalizes provider outputs into typed artifacts", async () => {
  const router = new ShortDramaRouter({ providers: [provider()], randomId: () => "artifact-job" })
  const created = await router.createVideo({ model: "test-provider/video-1", prompt: "A short scene" })
  const completed = await router.getVideo(created.id)
  assert.deepEqual(completed.artifacts, [{
    kind: "video",
    media_type: "video/mp4",
    url: "https://media.example/video.mp4",
  }])
})

test("marks uncertain provider acceptance without automatically resubmitting", async () => {
  let submissions = 0
  const adapter = provider()
  adapter.createVideo = async () => {
    submissions += 1
    throw new RouterError(
      "provider_timeout",
      "provider request timed out",
      504,
      { category: "timeout", retryable: true },
    )
  }
  const router = new ShortDramaRouter({ providers: [adapter], randomId: () => "unknown-job" })
  const created = await router.createVideo({ model: "test-provider/video-1", prompt: "A short scene" })
  assert.equal(created.status, "submission_unknown")
  assert.equal(created.error?.retryable, false)
  assert.equal((await router.getVideo(created.id)).status, "submission_unknown")
  assert.equal(submissions, 1)
})
