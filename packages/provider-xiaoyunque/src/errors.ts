import { RouterError } from "@shortdrama-router/core"

export class XiaoYunqueInputError extends RouterError {
  override readonly name = "XiaoYunqueInputError"

  constructor(message: string) {
    super("provider_invalid_request", message, 400, {
      category: "invalid_request",
      provider: "xiaoyunque",
      retryable: false,
    })
  }
}

export class XiaoYunqueAuthenticationError extends RouterError {
  override readonly name = "XiaoYunqueAuthenticationError"

  constructor(message: string) {
    super("provider_authorization_required", message, 409, {
      category: "authorization",
      provider: "xiaoyunque",
      retryable: false,
    })
  }
}

export class XiaoYunqueUpstreamError extends RouterError {
  override readonly name = "XiaoYunqueUpstreamError"

  constructor(
    message: string,
    readonly upstreamCode?: string | number,
  ) {
    super("provider_upstream_error", message, 502, {
      category: "provider_failure",
      provider: "xiaoyunque",
      ...(upstreamCode === undefined ? {} : { providerCode: String(upstreamCode) }),
      retryable: true,
    })
  }
}
