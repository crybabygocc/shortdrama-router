import { RouterError } from "@shortdrama-router/core"

export class LibTvInputError extends RouterError {
  override readonly name = "LibTvInputError"

  constructor(message: string) {
    super("invalid_libtv_request", message, 400, { category: "invalid_request", provider: "libtv", retryable: false })
  }
}

export class LibTvAuthenticationError extends RouterError {
  override readonly name = "LibTvAuthenticationError"

  constructor(message = "LibTV is not authorized") {
    super("libtv_not_authorized", message, 401, { category: "authorization", provider: "libtv", retryable: false })
  }
}

export class LibTvUnavailableError extends RouterError {
  override readonly name = "LibTvUnavailableError"

  constructor(message = "the managed LibTV CLI runtime is not installed; install provider libtv first") {
    super("libtv_cli_unavailable", message, 503, { category: "configuration", provider: "libtv", retryable: false })
  }
}

export class LibTvUpstreamError extends RouterError {
  override readonly name = "LibTvUpstreamError"

  constructor(message = "the official LibTV CLI command failed") {
    super("libtv_upstream_error", message, 502, { category: "provider_failure", provider: "libtv", retryable: true })
  }
}
