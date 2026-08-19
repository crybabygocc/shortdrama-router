import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workspacePackages = path.resolve(packageRoot, "..")
const typesRoot = path.join(packageRoot, "dist/bundle/types")

const packages = {
  "@shortdrama-router/core": path.join(typesRoot, "vendor/core/index.js"),
  "@shortdrama-router/http": path.join(typesRoot, "vendor/http/index.js"),
  "@shortdrama-router/provider-jimeng": path.join(typesRoot, "vendor/provider-jimeng/index.js"),
  "@shortdrama-router/provider-libtv": path.join(typesRoot, "vendor/provider-libtv/index.js"),
  "@shortdrama-router/provider-xiaoyunque": path.join(typesRoot, "vendor/provider-xiaoyunque/index.js"),
  "@shortdrama-router/runtime": path.join(typesRoot, "vendor/runtime/index.js"),
}

async function copyDeclarations(source, destination) {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const input = path.join(source, entry.name)
    const output = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      await copyDeclarations(input, output)
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      await writeFile(output, await readFile(input))
    }
  }
}

async function declarationFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await declarationFiles(target))
    if (entry.isFile() && entry.name.endsWith(".d.ts")) files.push(target)
  }
  return files
}

await rm(typesRoot, { force: true, recursive: true })
await copyDeclarations(path.join(packageRoot, "dist/src"), typesRoot)
await copyDeclarations(path.join(workspacePackages, "core/dist/src"), path.join(typesRoot, "vendor/core"))
await copyDeclarations(path.join(workspacePackages, "http/dist/src"), path.join(typesRoot, "vendor/http"))
await copyDeclarations(path.join(workspacePackages, "runtime/dist/src"), path.join(typesRoot, "vendor/runtime"))
await copyDeclarations(
  path.join(workspacePackages, "provider-jimeng/dist/src"),
  path.join(typesRoot, "vendor/provider-jimeng"),
)
await copyDeclarations(
  path.join(workspacePackages, "provider-libtv/dist/src"),
  path.join(typesRoot, "vendor/provider-libtv"),
)
await copyDeclarations(
  path.join(workspacePackages, "provider-xiaoyunque/dist/src"),
  path.join(typesRoot, "vendor/provider-xiaoyunque"),
)

for (const file of await declarationFiles(typesRoot)) {
  let contents = await readFile(file, "utf8")
  for (const [packageName, target] of Object.entries(packages)) {
    let relative = path.relative(path.dirname(file), target).split(path.sep).join("/")
    if (!relative.startsWith(".")) relative = `./${relative}`
    contents = contents
      .replaceAll(`'${packageName}'`, `'${relative}'`)
      .replaceAll(`"${packageName}"`, `"${relative}"`)
  }
  contents = contents.replace(/^\/\/# sourceMappingURL=.*$/gmu, "")
  await writeFile(file, contents)
}
