export class RouterError extends Error {
  override readonly name: string = "RouterError"

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function invalidRequest(message: string, code = "invalid_request") {
  return new RouterError(code, message, 400)
}

export function notFound(message: string, code = "not_found") {
  return new RouterError(code, message, 404)
}

export function conflict(message: string, code = "conflict") {
  return new RouterError(code, message, 409)
}
