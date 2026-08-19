import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import {
  jimengManagedCliPath,
  ShortDramaRouter,
  startRouterServer,
  type ProviderAdapter,
} from "../src/index.js"

test("uses the custom runtime root for server installation status", { skip: process.platform === "win32" }, async () => {
  const runtimeRootDir = await mkdtemp(path.join(tmpdir(), "shortdrama-server-root-"))
  const executable = jimengManagedCliPath(runtimeRootDir)
  await mkdir(path.dirname(executable), { recursive: true })
  await writeFile(executable, "#!/bin/sh\nprintf '{\"version\":\"server-managed\"}\\n'\n", { mode: 0o755 })
  const server = await startRouterServer({ port: 0, runtimeRootDir })
  try {
    const response = await fetch(`${server.url}/api/v1/providers/jimeng/runtime`)
    assert.equal(response.status, 200)
    const status = await response.json() as {
      executable_path: string
      state: string
      version: string
    }
    assert.equal(status.executable_path, executable)
    assert.equal(status.state, "installed")
    assert.equal(status.version, "server-managed")
  } finally {
    await server.close()
    await rm(runtimeRootDir, { force: true, recursive: true })
  }
})

const provider: ProviderAdapter = {
  metadata: {
    capabilities: {
      authorization: ["api_key"],
      generation: ["image", "video"],
      models: true,
      usage: false,
    },
    description: "Loopback test provider",
    id: "test-provider",
    name: "Test Provider",
  },
  async createImage() {
    return {
      outputs: [{ content_type: "image/png", url: "https://media.example/generated.png" }],
      reference: { remote_id: "image-1" },
      status: "completed",
    }
  },
  async createVideo() {
    return { reference: { remote_id: "video-1" }, status: "queued" }
  },
  async getAuthorizationStatus() {
    return { authorized: true, configured: true, method: "api_key", state: "valid" }
  },
  async getImage(reference) {
    return {
      outputs: [{ content_type: "image/png", url: "https://media.example/generated.png" }],
      reference,
      status: "completed",
    }
  },
  async getVideo(reference) {
    return {
      outputs: [{ content_type: "video/mp4", url: "https://media.example/generated.mp4" }],
      reference,
      status: "completed",
    }
  },
  async listModels() {
    return [
      {
        capabilities: { aspect_ratios: ["1:1"] },
        description: "Image model",
        id: "test-provider/image-1",
        kind: "image",
        name: "Image 1",
        provider: "test-provider",
      },
      {
        capabilities: { aspect_ratios: ["16:9"] },
        description: "Video model",
        id: "test-provider/video-1",
        kind: "video",
        name: "Video 1",
        provider: "test-provider",
      },
    ]
  },
}

test("serves image and video generation over a real loopback HTTP listener", async () => {
  let sequence = 0
  const server = await startRouterServer({
    port: 0,
    router: new ShortDramaRouter({
      providers: [provider],
      randomId: () => `job-${++sequence}`,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    }),
    routerKey: "router-test-key",
  })
  const headers = {
    Authorization: "Bearer router-test-key",
    "Content-Type": "application/json",
  }
  try {
    const unauthorized = await fetch(`${server.url}/api/v1/providers`)
    assert.equal(unauthorized.status, 401)

    const image = await fetch(`${server.url}/v1/images/generations`, {
      body: JSON.stringify({ model: "test-provider/image-1", prompt: "A frame", size: "1024x1024" }),
      headers,
      method: "POST",
    })
    assert.equal(image.status, 200)
    assert.deepEqual(await image.json(), {
      created: 1_786_406_400,
      data: [{ url: "https://media.example/generated.png" }],
    })

    const video = await fetch(`${server.url}/v1/videos`, {
      body: JSON.stringify({ model: "test-provider/video-1", prompt: "A scene" }),
      headers,
      method: "POST",
    })
    assert.equal(video.status, 202)
    const videoJob = await video.json() as { id: string }
    const completed = await fetch(`${server.url}/v1/videos/${videoJob.id}`, { headers })
    assert.equal((await completed.json() as { status: string }).status, "completed")
  } finally {
    await server.close()
  }
})
