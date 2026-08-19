import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import {
  defaultRuntimeRoot,
  detectRuntimePlatform,
  getManagedRuntimeStatus,
  installManagedRuntime,
  managedRuntimePath,
  RuntimeIntegrityError,
  verifyManagedRuntimeIntegrity,
  type ProviderRuntimeDefinition,
} from "../src/index.js"

const fixtureScript = Buffer.from("#!/bin/sh\nprintf '1.2.3\\n'\n")

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

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
  const artifactBytes = archive === "binary" ? fixtureScript : storedZip("bundle/fixture", fixtureScript)
  const release = {
    artifact: {
      archive,
      executable_sha256: sha256(fixtureScript),
      sha256: sha256(artifactBytes),
      url: `https://runtime.test/${archive}`,
    },
    version: "1.2.3",
  } as const
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
      return release
    },
    resolve_trusted_release(options) {
      return options.version === release.version ? release : undefined
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
  try {
    for (const archive of ["binary", "zip"] as const) {
      const runtime = definition(archive)
      const body = archive === "binary" ? fixtureScript : storedZip("bundle/fixture", fixtureScript)
      const installed = await installManagedRuntime(runtime, {
        fetch: async () => new Response(body),
        platform: process.arch === "arm64" ? "darwin-arm64" : "darwin-x64",
        rootDir,
      })
      assert.equal(installed.state, "installed")
      assert.equal(installed.compatible, true)
      assert.equal(installed.integrity_verified, true)
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

test("rejects a runtime whose downloaded artifact digest does not match", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "shortdrama-runtime-reject-"))
  try {
    await assert.rejects(
      installManagedRuntime(definition("binary"), {
        fetch: async () => new Response(Buffer.from("not the trusted executable")),
        platform: "darwin-arm64",
        rootDir,
      }),
      RuntimeIntegrityError,
    )
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})

test("detects replacement of an installed managed executable before execution", { skip: process.platform === "win32" }, async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "shortdrama-runtime-tampered-"))
  const runtime = definition("binary")
  const platform = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"
  try {
    await installManagedRuntime(runtime, {
      fetch: async () => new Response(fixtureScript),
      platform,
      rootDir,
    })
    await writeFile(managedRuntimePath(runtime, rootDir), "#!/bin/sh\nprintf 'tampered\\n'\n", { mode: 0o755 })
    const status = await getManagedRuntimeStatus(runtime, { platform, rootDir })
    assert.equal(status.state, "invalid")
    assert.equal(status.integrity_verified, false)
    assert.equal(status.reason_code, "runtime_integrity_failed")
    await assert.rejects(verifyManagedRuntimeIntegrity(runtime, { platform, rootDir }), RuntimeIntegrityError)
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
