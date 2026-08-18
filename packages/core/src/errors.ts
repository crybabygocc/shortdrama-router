export type RouterErrorCategory =
  | "invalid_request"
  | "unsupported"
  | "authorization"
  | "configuration"
  | "model_unavailable"
  | "rate_limit"
  | "provider_failure"
  | "timeout"
  | "cancelled"
  | "conflict"
  | "internal"

export interface RouterErrorOptions {
  readonly category?: RouterErrorCategory
  readonly provider?: string
  readonly providerCode?: string
  readonly retryAfterSeconds?: number
  readonly retryable?: boolean
}

function defaultCategory(status: number): RouterErrorCategory {
  if (status === 400 || status === 404) return "invalid_request"
  if (status === 401 || status === 403) return "authorization"
  if (status === 408 || status === 504) return "timeout"
  if (status === 409) return "conflict"
  if (status === 429) return "rate_limit"
  if (status >= 500 && status < 600) return "provider_failure"
  return "internal"
}

export class RouterError extends Error {
  override readonly name: string = "RouterError"

  readonly category: RouterErrorCategory
  readonly provider: string | undefined
  readonly providerCode: string | undefined
  readonly retryAfterSeconds: number | undefined
  readonly retryable: boolean

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    options: RouterErrorOptions = {},
  ) {
    super(message)
    this.category = options.category ?? defaultCategory(status)
    this.retryable = options.retryable ?? (status === 429 || status >= 500)
    this.provider = options.provider
    this.providerCode = options.providerCode
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export function invalidRequest(message: string, code = "invalid_request") {
  return new RouterError(code, message, 400)
}

export function notFound(message: string, code = "not_found") {
  return new RouterError(code, message, 404)
}

export function conflict(message: string, code = "conflict") {
  return new RouterError(code, message, 409, { category: "conflict", retryable: false })
}

export function unsupported(message: string, code = "capability_unsupported") {
  return new RouterError(code, message, 409, { category: "unsupported", retryable: false })
}
