import assert from "node:assert/strict"
import test from "node:test"
import { ShortDramaRouter, type ProviderAdapter } from "@shortdrama-router/core"
import { runCli } from "../src/cli.js"

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
  assert.equal(code, 0)
  assert.deepEqual(received, { host: "127.0.0.1", port: 18080 })
  assert.match(output.join("\n"), /listening on http:\/\/127\.0\.0\.1:18080/u)
})
