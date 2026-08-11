import { RouterError } from "@shortdrama-router/core"

export class LibTvInputError extends RouterError {
  override readonly name = "LibTvInputError"

  constructor(message: string) {
    super("invalid_libtv_request", message, 400)
  }
}

export class LibTvAuthenticationError extends RouterError {
  override readonly name = "LibTvAuthenticationError"

  constructor(message = "LibTV is not authorized") {
    super("libtv_not_authorized", message, 401)
  }
}

export class LibTvUnavailableError extends RouterError {
  override readonly name = "LibTvUnavailableError"

  constructor(message = "the official LibTV CLI is unavailable") {
    super("libtv_cli_unavailable", message, 503)
  }
}

export class LibTvUpstreamError extends RouterError {
  override readonly name = "LibTvUpstreamError"

  constructor(message = "the official LibTV CLI command failed") {
    super("libtv_upstream_error", message, 502)
  }
}
