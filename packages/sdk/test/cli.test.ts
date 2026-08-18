import assert from "node:assert/strict"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { ShortDramaRouter, type ProviderAdapter } from "@shortdrama-router/core"
import { isCliEntry, runCli } from "../src/cli.js"

const provider: ProviderAdapter = {
  metadata: {
    capabilities: { authorization: ["api_key"], generation: ["image", "video"], models: true, usage: false },
    description: "Test provider",
    id: "test-provider",
    name: "Test Provider",
  },
  async createVideo() { return { reference: {}, status: "queued" } },
  async getAuthorizationStatus() {
    return { authorized: true, configured: true, method: "api_key", state: "valid" }
  },
  async getVideo(reference) { return { reference, status: "queued" } },
  async listModels() { return [] },
}

test("lists provider authorization status as a table", async () => {
  const output: string[] = []
  const code = await runCli(["providers"], {
    io: { error: value => output.push(value), output: value => output.push(value) },
    router: new ShortDramaRouter({ providers: [provider] }),
  })
  assert.equal(code, 0)
  assert.match(output.join("\n"), /test-provider\s+Test Provider\s+valid \(api_key\)/u)
})

test("lists provider authorization status as JSON", async () => {
  const output: string[] = []
  const code = await runCli(["providers", "--json"], {
    io: { error: value => output.push(value), output: value => output.push(value) },
    router: new ShortDramaRouter({ providers: [provider] }),
  })
  assert.equal(code, 0)
  const result = JSON.parse(output[0] ?? "") as { data: Array<{ id: string }> }
  assert.equal(result.data[0]?.id, "test-provider")
})

test("starts the local HTTP server from the CLI", async () => {
  const previousAccessKey = process.env.XYQ_ACCESS_KEY
  const previousLegacyAccessKey = process.env.XIAOYUNQUE_ACCESS_KEY
  delete process.env.XYQ_ACCESS_KEY
  delete process.env.XIAOYUNQUE_ACCESS_KEY
  const output: string[] = []
  let received: { host?: string; port?: number } | undefined
  const code = await runCli(["serve", "--host", "127.0.0.1", "--port", "18080"], {
    io: { error: value => output.push(value), output: value => output.push(value) },
    startServer: async options => {
      received = options
      return {
        close: async () => undefined,
        finished: Promise.resolve(),
        url: "http://127.0.0.1:18080",
      }
    },
  })
  try {
    assert.equal(code, 0)
    assert.deepEqual(received, { host: "127.0.0.1", port: 18080 })
  } finally {
    if (previousAccessKey !== undefined) process.env.XYQ_ACCESS_KEY = previousAccessKey
    if (previousLegacyAccessKey !== undefined) process.env.XIAOYUNQUE_ACCESS_KEY = previousLegacyAccessKey
  }
  assert.match(output.join("\n"), /listening on http:\/\/127\.0\.0\.1:18080/u)
})

test("recognizes an npm bin symlink as the CLI entry", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "shortdrama-router-cli-"))
  try {
    const target = path.join(directory, "cli.js")
    const link = path.join(directory, "shortdrama-router")
    await writeFile(target, "")
    await symlink(target, link)

    assert.equal(isCliEntry(link, pathToFileURL(target).href), true)
    assert.equal(isCliEntry(path.join(directory, "missing"), pathToFileURL(target).href), false)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
