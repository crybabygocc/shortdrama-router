import { RouterError } from "@shortdrama-router/core"

export class JimengInputError extends RouterError {
  override readonly name = "JimengInputError"

  constructor(message: string) {
    super("invalid_jimeng_request", message, 400)
  }
}

export class JimengAuthenticationError extends RouterError {
  override readonly name = "JimengAuthenticationError"

  constructor(message = "Jimeng is not authorized") {
    super("jimeng_not_authorized", message, 401)
  }
}

export class JimengPlanError extends RouterError {
  override readonly name = "JimengPlanError"

  constructor() {
    super(
      "jimeng_plan_unsupported",
      "the current Jimeng account cannot generate through the official Dreamina CLI; an Advanced membership is required",
      403,
    )
  }
}

export class JimengUnavailableError extends RouterError {
  override readonly name = "JimengUnavailableError"

  constructor(message = "the official Dreamina CLI is unavailable") {
    super("jimeng_cli_unavailable", message, 503)
  }
}

export class JimengUpstreamError extends RouterError {
  override readonly name = "JimengUpstreamError"

  constructor(message = "the official Dreamina CLI command failed") {
    super("jimeng_upstream_error", message, 502)
  }
}
