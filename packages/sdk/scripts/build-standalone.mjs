import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = path.resolve(packageRoot, "../..")
const outputDirectory = path.join(packageRoot, "dist/standalone")
const platform = `${process.platform}-${process.arch}`
const executableName = process.platform === "win32" ? "shortdrama-router.exe" : "shortdrama-router"
const executablePath = path.join(outputDirectory, executableName)
const entryPath = path.join(outputDirectory, "entry.cjs")
const blobPath = path.join(outputDirectory, "sea-prep.blob")
const configPath = path.join(outputDirectory, "sea-config.json")

await rm(outputDirectory, { force: true, recursive: true })
await mkdir(outputDirectory, { recursive: true })
await build({
  bundle: true,
  define: { "import.meta.url": '"sea:"' },
  entryPoints: [path.join(packageRoot, "src/standalone.ts")],
  format: "cjs",
  outfile: entryPath,
  platform: "node",
  target: "node22",
  tsconfig: path.join(packageRoot, "tsconfig.bundle.json"),
})
await writeFile(configPath, `${JSON.stringify({
  disableExperimentalSEAWarning: true,
  main: entryPath,
  output: blobPath,
  useCodeCache: false,
  useSnapshot: false,
}, null, 2)}\n`)
execFileSync(process.execPath, ["--experimental-sea-config", configPath], { stdio: "inherit" })
await copyFile(process.execPath, executablePath)
if (process.platform === "darwin") {
  execFileSync("codesign", ["--remove-signature", executablePath], { stdio: "inherit" })
}
const postject = path.join(workspaceRoot, "node_modules/postject/dist/cli.js")
execFileSync(process.execPath, [
  postject,
  executablePath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
], { stdio: "inherit" })
if (process.platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", executablePath], { stdio: "inherit" })
}
if (process.platform !== "win32") await chmod(executablePath, 0o755)
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"))
const sha256 = createHash("sha256").update(await readFile(executablePath)).digest("hex")
await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify({
  executable: executableName,
  platform,
  sha256,
  version: packageJson.version,
}, null, 2)}\n`)
await rm(entryPath, { force: true })
await rm(blobPath, { force: true })
await rm(configPath, { force: true })
process.stdout.write(`${executablePath}\n`)
