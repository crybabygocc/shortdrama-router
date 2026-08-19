import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import {
  defaultRuntimeRoot,
  detectRuntimePlatform,
  getManagedRuntimeStatus,
  installManagedRuntime,
  type ProviderRuntimeDefinition,
} from "../src/index.js"

function storedZip(name: string, contents: Buffer) {
  const filename = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(contents.length, 18)
  local.writeUInt32LE(contents.length, 22)
  local.writeUInt16LE(filename.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(contents.length, 20)
  central.writeUInt32LE(contents.length, 24)
  central.writeUInt16LE(filename.length, 28)
  const centralOffset = local.length + filename.length + contents.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + filename.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, filename, contents, central, filename, end])
}

function definition(archive: "binary" | "zip"): ProviderRuntimeDefinition {
  return {
    display_name: "Fixture runtime",
    executable: "fixture",
    id: `fixture-${archive}`,
    platforms: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"],
    probe(output) {
      const version = output.trim()
      return { compatible: version === "1.2.3", version }
    },
    async resolve_release() {
      return {
        artifact: {
          archive,
          url: `https://runtime.test/${archive}`,
        },
        version: "1.2.3",
      }
    },
    version_command: [],
  }
}

test("detects supported platforms and platform-specific data roots", () => {
  assert.equal(detectRuntimePlatform("darwin", "arm64"), "darwin-arm64")
  assert.equal(detectRuntimePlatform("linux", "amd64"), "linux-x64")
  assert.equal(detectRuntimePlatform("aix", "ppc64"), undefined)
  assert.equal(defaultRuntimeRoot({ env: {}, home: "/user", platform: "darwin" }), path.join("/user", "Library", "Application Support", "shortdrama-router", "runtimes"))
  assert.equal(defaultRuntimeRoot({ env: { XDG_DATA_HOME: "/data" }, home: "/user", platform: "linux" }), path.join("/data", "shortdrama-router", "runtimes"))
})

test("installs and probes binary and ZIP provider runtimes", { skip: process.platform === "win32" }, async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "shortdrama-runtime-"))
  const script = Buffer.from("#!/bin/sh\nprintf '1.2.3\\n'\n")
  try {
    for (const archive of ["binary", "zip"] as const) {
      const runtime = definition(archive)
      const body = archive === "binary" ? script : storedZip("bundle/fixture", script)
      const installed = await installManagedRuntime(runtime, {
        fetch: async () => new Response(body),
        platform: process.arch === "arm64" ? "darwin-arm64" : "darwin-x64",
        rootDir,
      })
      assert.equal(installed.state, "installed")
      assert.equal(installed.compatible, true)
      assert.equal(installed.version, "1.2.3")
      assert.equal((await getManagedRuntimeStatus(runtime, {
        platform: process.arch === "arm64" ? "darwin-arm64" : "darwin-x64",
        rootDir,
      })).state, "installed")
    }
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})

test("reports a missing runtime without using PATH", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "shortdrama-runtime-missing-"))
  try {
    const status = await getManagedRuntimeStatus(definition("binary"), {
      platform: "darwin-arm64",
      rootDir,
    })
    assert.equal(status.state, "not_installed")
    assert.equal(status.compatible, false)
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})
