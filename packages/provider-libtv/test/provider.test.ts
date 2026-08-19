import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import {
  libtvRuntimeDefinition,
  LibTvProcessRunner,
  LibTvProvider,
  LibTvUnavailableError,
  MemoryLibTvConfiguration,
  type LibTvCommandRunner,
} from "../src/index.js"

test("does not fall back to a legacy user-directory LibTV CLI", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "libtv-managed-only-"))
  const previousHome = process.env.HOME
  const previousDataDir = process.env.SHORTDRAMA_ROUTER_DATA_DIR
  try {
    const home = path.join(directory, "home")
    const legacyCli = path.join(home, ".libtv", "libtv")
    await mkdir(path.dirname(legacyCli), { recursive: true })
    await writeFile(legacyCli, "#!/bin/sh\nprintf '1.0.2\\n'\n", { mode: 0o755 })
    process.env.HOME = home
    process.env.SHORTDRAMA_ROUTER_DATA_DIR = path.join(directory, "managed-data")

    await assert.rejects(
      new LibTvProcessRunner().run(["--version"]),
      LibTvUnavailableError,
    )
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousDataDir === undefined) delete process.env.SHORTDRAMA_ROUTER_DATA_DIR
    else process.env.SHORTDRAMA_ROUTER_DATA_DIR = previousDataDir
    await rm(directory, { force: true, recursive: true })
  }
})

test("starts the CLI web login, returns its URL and uses the configured credential directory", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "libtv-web-login-runner-"))
  const cliPath = path.join(directory, "libtv")
  const configDir = path.join(directory, "credentials")
  await mkdir(configDir)
  await writeFile(cliPath, [
    "#!/bin/sh",
    "printf '%s' \"$LIBTV_CONFIG_DIR\" > \"$LIBTV_CONFIG_DIR/seen-config-dir\"",
    "printf 'https://www.liblib.tv/zh?callback_url=http%%3A%%2F%%2F127.0.0.1%%3A5002%%2Fcallback\\n' >&2",
    "trap 'exit 2' TERM INT",
    "while :; do sleep 1; done",
  ].join("\n"), { mode: 0o755 })
  try {
    const session = await new LibTvProcessRunner({ cliPath, configDir, timeoutMs: 5_000 }).beginWebAuthorization()
    assert.match(session.login_url, /^https:\/\/www\.liblib\.tv\/zh\?/u)
    assert.equal(await readFile(path.join(configDir, "seen-config-dir"), "utf8"), configDir)
    session.cancel()
    await assert.rejects(session.completed)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("pins the managed LibTV runtime to the adapter-compatible release", async () => {
  const release = await libtvRuntimeDefinition.resolve_release({
    fetch,
    platform: "darwin-arm64",
  })
  assert.equal(release.version, "1.0.2")
  assert.match(release.artifact.url, /\/1\.0\.2\/libtv-macos-arm64\.zip$/u)
  assert.equal(release.artifact.sha256, "f8a320e9e34b266699410f8ddd00f54004304449cad2ec03367401dac42bba61")
  assert.equal(release.artifact.executable_sha256, "8605ff53e9f2185f09ba59597ba811e12d90294411ae15710e334be56a4d6e34")
  assert.equal(libtvRuntimeDefinition.probe("1.0.2").compatible, true)
  assert.equal(libtvRuntimeDefinition.probe("1.1.0").compatible, false)
})

class FakeRunner implements LibTvCommandRunner {
  readonly calls: string[][] = []

  async run(args: readonly string[]) {
    this.calls.push([...args])
    if (args[0] === "--version") return { stdout: "1.0.2\n" }
    if (args[0] === "account") return { stdout: JSON.stringify({ user: { id: 1 } }) }
    if (args[0] === "project") {
      return {
        stdout: JSON.stringify({
          projectMetaList: [{ name: "Test Project", uuid: "0000000000000000000000000000abcd" }],
          total: 1,
        }),
      }
    }
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

test("starts, reports and completes LibTV web authorization without a terminal", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "libtv-provider-web-login-"))
  let finish!: (result: { stdout: string }) => void
  let cancelled = false
  const completed = new Promise<{ stdout: string }>(resolve => {
    finish = resolve
  })
  const runner: LibTvCommandRunner = {
    async beginWebAuthorization() {
      return {
        cancel() {
          cancelled = true
        },
        completed,
        login_url: "https://www.liblib.tv/zh?callback_url=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback",
      }
    },
    async run(args) {
      if (args[0] === "account") return { stdout: JSON.stringify({ user: { id: 1 } }) }
      if (args[0] === "logout") return { stdout: "" }
      throw new Error(`unexpected command: ${args.join(" ")}`)
    },
  }
  try {
    const provider = new LibTvProvider({ configDir, randomId: () => "libtv-auth-1", runner })
    assert.deepEqual(provider.metadata.capabilities.authorization_methods, [{
      actions: ["status", "begin", "complete", "cancel", "clear"],
      management: "managed",
      method: "oauth",
    }])
    const request = await provider.beginAuthorization("oauth")
    assert.equal(request.authorization_id, "libtv-auth-1")
    assert.match(request.login_url, /^https:\/\/www\.liblib\.tv\/zh\?/u)
    assert.equal((await provider.getAuthorizationStatus({ probe: true })).state, "pending")

    await writeFile(path.join(configDir, "credentials.json"), "{}")
    finish({ stdout: path.join(configDir, "credentials.json") })
    await new Promise(resolve => setImmediate(resolve))
    const status = await provider.completeAuthorization({
      authorization_id: request.authorization_id,
      method: "oauth",
    })
    assert.equal(status.state, "valid")
    assert.equal(cancelled, false)
  } finally {
    await rm(configDir, { force: true, recursive: true })
  }
})

test("cancels a pending LibTV web authorization", async () => {
  let cancelled = false
  let finish!: (result: { stdout: string }) => void
  const completed = new Promise<{ stdout: string }>(resolve => {
    finish = resolve
  })
  const runner: LibTvCommandRunner = {
    async beginWebAuthorization() {
      return {
        cancel() {
          cancelled = true
          finish({ stdout: "" })
        },
        completed,
        login_url: "https://www.liblib.tv/zh?callback_url=http%3A%2F%2F127.0.0.1%3A5001%2Fcallback",
      }
    },
    async run() {
      return { stdout: "" }
    },
  }
  const provider = new LibTvProvider({ randomId: () => "libtv-auth-cancel", runner })
  const request = await provider.beginAuthorization("oauth")
  await provider.cancelAuthorization(request.authorization_id)
  assert.equal(cancelled, true)
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

test("discovers and persists LibTV project configuration separately from authorization", async () => {
  const configuration = new MemoryLibTvConfiguration()
  const provider = new LibTvProvider({ configuration, runner: new FakeRunner() })
  assert.equal((await provider.getConfigurationStatus()).state, "configuration_required")
  assert.deepEqual(await provider.listResources({ type: "project" }), [{
    id: "0000000000000000000000000000abcd",
    name: "Test Project",
    type: "project",
  }])
  const configured = await provider.configure({
    resource_id: "0000000000000000000000000000abcd",
    resource_type: "project",
  })
  assert.equal(configured.state, "configuration_valid")
  assert.equal((await provider.getConfigurationStatus()).resource?.id, "0000000000000000000000000000abcd")
  const dependencies = await provider.getDependencyStatuses({ probe: true })
  assert.equal(dependencies[0]?.version, "1.0.2")
})
