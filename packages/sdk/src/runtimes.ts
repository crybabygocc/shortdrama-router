import type {
  ProviderRuntimeInstallOptions,
  ProviderRuntimeService,
  ProviderRuntimeStatusOptions,
} from "@shortdrama-router/runtime"
import {
  getJimengRuntimeStatus,
  installJimengRuntime,
} from "@shortdrama-router/provider-jimeng"
import {
  getLibTvRuntimeStatus,
  installLibTvRuntime,
} from "@shortdrama-router/provider-libtv"

export interface BuiltInRuntimeServiceOptions
  extends Pick<ProviderRuntimeInstallOptions, "fetch" | "now" | "platform" | "rootDir"> {}

export function createBuiltInRuntimeService(
  options: BuiltInRuntimeServiceOptions = {},
): ProviderRuntimeService {
  const statusOptions = (signal?: AbortSignal): ProviderRuntimeStatusOptions => ({
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.rootDir ? { rootDir: options.rootDir } : {}),
    ...(signal ? { signal } : {}),
  })
  const installOptions = (signal?: AbortSignal): ProviderRuntimeInstallOptions => ({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.rootDir ? { rootDir: options.rootDir } : {}),
    ...(signal ? { signal } : {}),
  })
  return {
    getStatus(provider, request = {}) {
      if (provider === "jimeng") return getJimengRuntimeStatus(statusOptions(request.signal))
      if (provider === "libtv") return getLibTvRuntimeStatus(statusOptions(request.signal))
      throw new Error(`provider ${provider} does not require a managed runtime`)
    },
    install(provider, request = {}) {
      if (provider === "jimeng") return installJimengRuntime(installOptions(request.signal))
      if (provider === "libtv") return installLibTvRuntime(installOptions(request.signal))
      throw new Error(`provider ${provider} does not require a managed runtime`)
    },
    supports(provider) {
      return provider === "jimeng" || provider === "libtv"
    },
  }
}
