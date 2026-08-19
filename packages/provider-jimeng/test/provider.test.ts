import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import {
  JimengProvider,
  jimengRuntimeDefinition,
  type JimengCommandRunner,
} from "../src/index.js"

test("maps the current platform to the official managed Dreamina artifact", async () => {
  const release = await jimengRuntimeDefinition.resolve_release({
    fetch: async () => Response.json({ version: "1.4.17" }),
    platform: "darwin-arm64",
  })
  assert.equal(release.version, "1.4.17")
  assert.match(release.artifact.url, /dreamina_cli_darwin_arm64$/u)
  assert.deepEqual(jimengRuntimeDefinition.probe(JSON.stringify({ version: "build-one" })), {
    compatible: true,
    version: "build-one",
  })
})

const imageHelp = `
Supported combinations:
- model_version: 3.0, 3.1, 4.0, 4.1, 4.5, 4.6, 4.7, 5.0, 5.0Pro
`
const videoHelp = `
Supported combinations:
- model_version: seedance2.0, seedance2.0fast, seedance2.0_vip, seedance2.0fast_vip, seedance2.0mini, seedance2.5
`

class FakeRunner implements JimengCommandRunner {
  readonly calls: string[][] = []

  async run(args: readonly string[]) {
    this.calls.push([...args])
    if (args[0] === "--version") return { stdout: JSON.stringify({ version: "test-build" }) }
    if (args[0] === "user_credit") {
      return { stdout: JSON.stringify({ total_credit: 37, vip_level: "advanced" }) }
    }
    if (args[0] === "login" && args[1] === "--headless") {
      return {
        stdout: [
          "verification_uri: https://jimeng.jianying.com/ai-tool/cli-auth?code=one",
          "device_code: device-one",
        ].join("\n"),
      }
    }
    if (args[0] === "login" && args[1] === "checklogin") return { stdout: "OAuth 登录成功。" }
    if (args[0] === "text2image" && args[1] === "-h") return { stdout: imageHelp }
    if (args[0] === "text2video" && args[1] === "-h") return { stdout: videoHelp }
    if (args[0] === "text2image") {
      return { stdout: JSON.stringify({ gen_status: "querying", submit_id: "image-submit" }) }
    }
    if (args[0] === "text2video") {
      return { stdout: JSON.stringify({ gen_status: "querying", submit_id: "video-submit" }) }
    }
    if (args[0] === "query_result") {
      const image = args.some(value => value.includes("image-submit"))
      return {
        stdout: JSON.stringify({
          gen_status: "success",
          result: { url: `https://media.example/${image ? "image.webp" : "video.mp4"}` },
          submit_id: image ? "image-submit" : "video-submit",
        }),
      }
    }
    if (args[0] === "logout") return { stdout: "" }
    throw new Error(`unexpected command: ${args.join(" ")}`)
  }
}

test("uses Jimeng OAuth Device Flow without browser cookies", async t => {
  const configDir = await mkdtemp(path.join(tmpdir(), "jimeng-provider-oauth-"))
  t.after(() => rm(configDir, { recursive: true }))
  const runner = new FakeRunner()
  const provider = new JimengProvider({ configDir, runner })
  const request = await provider.beginAuthorization("oauth")
  assert.match(request.login_url, /^https:\/\/jimeng\.jianying\.com\/ai-tool\/cli-auth/u)
  const status = await provider.completeAuthorization({
    authorization_id: request.authorization_id,
    method: "oauth",
  })
  assert.equal(status.state, "valid")
  assert.ok(runner.calls.some(call => call.includes("--device_code=device-one")))
})

test("discovers official Jimeng models and submits async image and video jobs", async () => {
  const runner = new FakeRunner()
  const provider = new JimengProvider({ runner })
  const models = await provider.listModels()
  assert.ok(models.some(model => model.id === "jimeng/5.0" && model.name === "Image 5.0 Lite"))
  assert.ok(models.some(model => model.id === "jimeng/seedance2.5" && model.kind === "video"))

  const image = await provider.createImage({
    aspect_ratio: "1:1",
    model: "jimeng/5.0",
    n: 1,
    prompt: "A glass cup",
    resolution: "2k",
  })
  assert.equal(image.status, "in_progress")
  const completedImage = await provider.getImage(image.reference)
  assert.equal(completedImage.status, "completed")
  assert.equal(completedImage.outputs?.[0]?.url, "https://media.example/image.webp")

  const video = await provider.createVideo({
    aspect_ratio: "16:9",
    duration: 4,
    model: "jimeng/seedance2.0mini",
    prompt: "A paper boat",
    resolution: "720p",
  })
  assert.equal(video.status, "in_progress")
  assert.equal((await provider.getVideo(video.reference)).status, "completed")
})

test("reports Jimeng as not configured before local OAuth state exists", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "jimeng-provider-"))
  await rm(configDir, { recursive: true })
  const provider = new JimengProvider({ configDir, runner: new FakeRunner() })
  assert.equal((await provider.getAuthorizationStatus()).state, "not_configured")
})

test("recognizes the Dreamina dependency version before making it available", async () => {
  const provider = new JimengProvider({ runner: new FakeRunner() })
  const dependency = (await provider.getDependencyStatuses({ probe: true }))[0]
  assert.equal(dependency?.available, true)
  assert.equal(dependency?.compatible, true)
  assert.equal(dependency?.version, "test-build")
})
