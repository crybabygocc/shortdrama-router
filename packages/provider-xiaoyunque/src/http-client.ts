import { XiaoYunqueAuthenticationError, XiaoYunqueUpstreamError } from "./errors.js"

const maximumResponseBytes = 2 * 1024 * 1024

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function boundedJson(response: Response) {
  const declaredLength = response.headers.get("content-length")
  if (declaredLength !== null) {
    const parsed = Number(declaredLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumResponseBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new XiaoYunqueUpstreamError("XiaoYunque returned an invalid response")
    }
  }
  const reader = response.body?.getReader()
  if (!reader) throw new XiaoYunqueUpstreamError("XiaoYunque returned an invalid response")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined)
        throw new XiaoYunqueUpstreamError("XiaoYunque returned an invalid response")
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  if (length === 0) {
    throw new XiaoYunqueUpstreamError("XiaoYunque returned an invalid response")
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new XiaoYunqueUpstreamError("XiaoYunque returned an invalid response")
  }
}

export async function requestEnvelope(
  fetchLike: FetchLike,
  url: URL,
  init: RequestInit,
  signal?: AbortSignal,
  acceptedBusinessCodes: readonly (number | string)[] = [],
) {
  const response = await fetchLike(url, {
    ...init,
    redirect: "error",
    ...(signal === undefined ? {} : { signal }),
  })
  const value = await boundedJson(response)
  const envelope = record(value)
  if (!envelope) throw new XiaoYunqueUpstreamError("XiaoYunque returned an invalid response")
  const ret = envelope.ret
  if (response.status === 401 || response.status === 403 || Number(ret) === 2 || Number(ret) === 1015) {
    throw new XiaoYunqueAuthenticationError("XiaoYunque authorization is no longer valid")
  }
  if (!response.ok) throw new XiaoYunqueUpstreamError("XiaoYunque request failed")
  const acceptedBusinessCode = acceptedBusinessCodes.some(code => String(code) === String(ret))
  if (ret !== 0 && ret !== "0" && !acceptedBusinessCode) {
    throw new XiaoYunqueUpstreamError("XiaoYunque rejected the request", typeof ret === "string" || typeof ret === "number" ? ret : undefined)
  }
  const data = record(envelope.data)
  if (!data && !acceptedBusinessCode) throw new XiaoYunqueUpstreamError("XiaoYunque returned an invalid response")
  return data ?? {}
}

export function requireString(value: unknown, label: string, maximum = 8_192) {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value !== value.trim()
    || Buffer.byteLength(value, "utf8") > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new XiaoYunqueUpstreamError(`${label} is invalid`)
  }
  return value
}

export function asRecord(value: unknown, label: string) {
  const result = record(value)
  if (!result) throw new XiaoYunqueUpstreamError(`${label} is invalid`)
  return result
}
