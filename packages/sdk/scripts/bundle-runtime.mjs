import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outdir = path.join(packageRoot, "dist/bundle")

await rm(outdir, { force: true, recursive: true })
await build({
  bundle: true,
  entryPoints: {
    cli: path.join(packageRoot, "src/cli.ts"),
    index: path.join(packageRoot, "src/index.ts"),
  },
  format: "esm",
  outdir,
  platform: "node",
  splitting: false,
  target: "node22",
  tsconfig: path.join(packageRoot, "tsconfig.bundle.json"),
})
