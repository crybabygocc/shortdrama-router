import {
  ShortDramaRouter,
  type ProviderAdapter,
  type ShortDramaRouterOptions,
} from "@shortdrama-router/core"
import {
  XiaoYunqueProvider,
  type XiaoYunqueProviderOptions,
} from "@shortdrama-router/provider-xiaoyunque"

export * from "@shortdrama-router/core"
export * from "@shortdrama-router/http"
export * from "@shortdrama-router/provider-xiaoyunque"
export * from "./server.js"

export interface CreateShortDramaRouterOptions
  extends Omit<ShortDramaRouterOptions, "providers"> {
  readonly providers?: readonly ProviderAdapter[]
  readonly xiaoyunque?: XiaoYunqueProviderOptions | false
}

export function createShortDramaRouter(options: CreateShortDramaRouterOptions = {}) {
  const providers = [...(options.providers ?? [])]
  if (options.xiaoyunque !== false) {
    providers.push(new XiaoYunqueProvider(options.xiaoyunque ?? {}))
  }
  return new ShortDramaRouter({
    providers,
    ...(options.imageJobStore === undefined ? {} : { imageJobStore: options.imageJobStore }),
    ...(options.jobStore === undefined ? {} : { jobStore: options.jobStore }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.randomId === undefined ? {} : { randomId: options.randomId }),
  })
}
