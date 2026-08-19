import { homedir } from "node:os"
import path from "node:path"
import type { RuntimePlatform } from "./types.js"

export function detectRuntimePlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): RuntimePlatform | undefined {
  const normalizedArch = arch === "aarch64" ? "arm64" : arch === "amd64" ? "x64" : arch
  if (platform === "darwin" && (normalizedArch === "arm64" || normalizedArch === "x64")) {
    return `darwin-${normalizedArch}`
  }
  if (platform === "linux" && (normalizedArch === "arm64" || normalizedArch === "x64")) {
    return `linux-${normalizedArch}`
  }
  if (platform === "win32" && (normalizedArch === "arm64" || normalizedArch === "x64")) {
    return `win32-${normalizedArch}`
  }
  return undefined
}

export function defaultRuntimeRoot(options: {
  readonly env?: NodeJS.ProcessEnv
  readonly home?: string
  readonly platform?: NodeJS.Platform
} = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  if (env.SHORTDRAMA_ROUTER_DATA_DIR) return path.resolve(env.SHORTDRAMA_ROUTER_DATA_DIR, "runtimes")
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "shortdrama-router", "runtimes")
  }
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "shortdrama-router", "runtimes")
  }
  return path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "shortdrama-router", "runtimes")
}

export function managedRuntimePath(
  definition: Pick<import("./types.js").ProviderRuntimeDefinition, "executable" | "id">,
  rootDir = defaultRuntimeRoot(),
) {
  return path.join(path.resolve(rootDir), definition.id, definition.executable)
}
