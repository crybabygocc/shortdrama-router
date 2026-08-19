import {
  ShortDramaRouter,
  type ProviderAdapter,
  type ShortDramaRouterOptions,
} from "@shortdrama-router/core"
import {
  XiaoYunqueProvider,
  type XiaoYunqueProviderOptions,
} from "@shortdrama-router/provider-xiaoyunque"
import {
  JimengProvider,
  type JimengProviderOptions,
} from "@shortdrama-router/provider-jimeng"
import {
  LibTvProvider,
  type LibTvProviderOptions,
} from "@shortdrama-router/provider-libtv"

export * from "@shortdrama-router/core"
export * from "@shortdrama-router/http"
export * from "@shortdrama-router/provider-jimeng"
export * from "@shortdrama-router/provider-libtv"
export * from "@shortdrama-router/provider-xiaoyunque"
export * from "@shortdrama-router/runtime"
export * from "./runtimes.js"
export * from "./server.js"

export interface CreateShortDramaRouterOptions
  extends Omit<ShortDramaRouterOptions, "providers"> {
  readonly jimeng?: JimengProviderOptions | false
  readonly libtv?: LibTvProviderOptions | false
  readonly providers?: readonly ProviderAdapter[]
  readonly xiaoyunque?: XiaoYunqueProviderOptions | false
}

export function createShortDramaRouter(options: CreateShortDramaRouterOptions = {}) {
  const providers = [...(options.providers ?? [])]
  if (options.jimeng !== false) {
    providers.push(new JimengProvider(options.jimeng ?? {}))
  }
  if (options.libtv !== false) {
    providers.push(new LibTvProvider(options.libtv ?? {}))
  }
  if (options.xiaoyunque !== false) {
    providers.push(new XiaoYunqueProvider(options.xiaoyunque ?? {}))
  }
  return new ShortDramaRouter({
    providers,
    ...(options.audioJobStore === undefined ? {} : { audioJobStore: options.audioJobStore }),
    ...(options.imageJobStore === undefined ? {} : { imageJobStore: options.imageJobStore }),
    ...(options.jobStore === undefined ? {} : { jobStore: options.jobStore }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.randomId === undefined ? {} : { randomId: options.randomId }),
  })
}
