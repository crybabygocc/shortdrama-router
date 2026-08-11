import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import {
  LibTvProvider,
  type LibTvCommandRunner,
} from "../src/index.js"

class FakeRunner implements LibTvCommandRunner {
  readonly calls: string[][] = []

  async run(args: readonly string[]) {
    this.calls.push([...args])
    if (args[0] === "account") return { stdout: JSON.stringify({ user: { id: 1 } }) }
    if (args[0] === "model" && args[1] === "search") {
      const kind = args[args.indexOf("--type") + 1]
      return {
        stdout: JSON.stringify({
          matches: kind === "image"
            ? [{ modelKey: "lib-image-2", modelName: "Lib Image", description: "Image model" }]
            : [{ modelKey: "star-video2-mini", modelName: "Seedance 2.0 Mini", description: "Video model" }],
        }),
      }
    }
    if (args[0] === "model") {
      const image = args[1] === "lib-image-2"
      return {
        stdout: JSON.stringify({
          modality: image ? "image" : "video",
          schema: { modelName: image ? "Lib Image" : "Seedance 2.0 Mini", properties: {} },
        }),
      }
    }
    if (args[0] === "node") {
      const image = args.includes("image")
      return {
        stdout: [
          JSON.stringify({ nodeKey: "created-node" }, null, 2),
          JSON.stringify({
            data: {
              taskInfo: { status: 2, taskId: image ? "image-task" : "video-task" },
              url: [`https://media.example/${image ? "image.png" : "video.mp4"}`],
            },
            nodeKey: image ? "image-node" : "video-node",
          }, null, 2),
        ].join("\n"),
      }
    }
    throw new Error(`unexpected command: ${args.join(" ")}`)
  }
}

test("discovers live LibTV models and probes local authorization", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "libtv-provider-"))
  try {
    await writeFile(path.join(configDir, "credentials.json"), "{}")
    const runner = new FakeRunner()
    const provider = new LibTvProvider({ configDir, runner })
    assert.equal((await provider.getAuthorizationStatus()).state, "configured")
    assert.equal((await provider.getAuthorizationStatus({ probe: true })).state, "valid")
    const models = await provider.listModels()
    assert.deepEqual(models.map(model => model.id), [
      "libtv/lib-image-2",
      "libtv/star-video2-mini",
    ])
  } finally {
    await rm(configDir, { force: true, recursive: true })
  }
})

test("runs LibTV image and video nodes to terminal results", async () => {
  const runner = new FakeRunner()
  const provider = new LibTvProvider({
    projectUuid: "0000000000000000000000000000abcd",
    randomId: () => "job-id",
    runner,
  })
  const image = await provider.createImage({
    aspect_ratio: "1:1",
    model: "libtv/lib-image-2",
    n: 1,
    prompt: "A cup",
    provider_options: { settings: { quality: "low" } },
    resolution: "1K",
  })
  assert.equal(image.status, "completed")
  assert.equal(image.outputs?.[0]?.url, "https://media.example/image.png")
  const imageCall = runner.calls.find(call => call[0] === "node" && call.includes("image"))
  assert.ok(imageCall?.includes("model=Lib Image"))
  assert.ok(imageCall?.includes("quality=low"))

  const video = await provider.createVideo({
    aspect_ratio: "16:9",
    duration: 4,
    model: "libtv/star-video2-mini",
    prompt: "A paper boat",
    provider_options: { settings: { enableSound: "off" } },
    resolution: "480p",
  })
  assert.equal(video.status, "completed")
  assert.equal(video.outputs?.[0]?.url, "https://media.example/video.mp4")
  assert.equal((await provider.getVideo(video.reference)).status, "completed")
})
