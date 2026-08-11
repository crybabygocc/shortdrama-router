import { RouterError } from "@shortdrama-router/core"

export class XiaoYunqueInputError extends RouterError {
  override readonly name = "XiaoYunqueInputError"

  constructor(message: string) {
    super("provider_invalid_request", message, 400)
  }
}

export class XiaoYunqueAuthenticationError extends RouterError {
  override readonly name = "XiaoYunqueAuthenticationError"

  constructor(message: string) {
    super("provider_authorization_required", message, 409)
  }
}

export class XiaoYunqueUpstreamError extends RouterError {
  override readonly name = "XiaoYunqueUpstreamError"

  constructor(
    message: string,
    readonly upstreamCode?: string | number,
  ) {
    super("provider_upstream_error", message, 502)
  }
}
