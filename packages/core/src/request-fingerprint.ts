import { createHash } from "node:crypto"
import { invalidRequest } from "./errors.js"

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw invalidRequest("generation request contains a non-finite number")
  }
  return value
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function requestFingerprint(value: unknown) {
  return sha256(JSON.stringify(canonical(value)))
}

export function idempotencyKeyHash(value: string | undefined) {
  if (value === undefined) return undefined
  if (value.length < 1 || value.length > 128 || !/^[\x21-\x7e]+$/u.test(value)) {
    throw invalidRequest("idempotency key must contain 1 to 128 printable ASCII characters", "invalid_idempotency_key")
  }
  return sha256(value)
}
