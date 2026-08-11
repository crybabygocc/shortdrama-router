import {
  normalizeWebSession,
  webSessionCookieHeader,
  type XiaoYunqueWebSession,
} from "./credentials.js"
import { XiaoYunqueAuthenticationError, XiaoYunqueInputError } from "./errors.js"
import { type FetchLike, requestEnvelope, requireString } from "./http-client.js"

const generateAccessKeyPath = "/api/biz/v1/user/generate_ak"
const supportedLifetimeDays = new Set([7, 30, 90, 365])

export interface XiaoYunqueAccessKeyEnrollmentOptions {
  readonly description?: string
  readonly lifetimeDays?: 7 | 30 | 90 | 365
  readonly name?: string
}

export interface XiaoYunqueAccessKeyEnrollmentClientOptions {
  readonly baseUrl: URL
  readonly fetch: FetchLike
}

function boundedText(value: string, label: string, maximum: number) {
  const normalized = value.trim()
  if (
    normalized.length === 0
    || Buffer.byteLength(normalized, "utf8") > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new XiaoYunqueInputError(`${label} is invalid`)
  }
  return normalized
}

export class XiaoYunqueAccessKeyEnrollmentClient {
  readonly #baseUrl: URL
  readonly #fetch: FetchLike

  constructor(options: XiaoYunqueAccessKeyEnrollmentClientOptions) {
    this.#baseUrl = options.baseUrl
    this.#fetch = options.fetch
  }

  async create(
    session: XiaoYunqueWebSession,
    now: Date,
    options: XiaoYunqueAccessKeyEnrollmentOptions = {},
    signal?: AbortSignal,
  ) {
    const normalizedSession = normalizeWebSession(session)
    const cookie = normalizedSession && webSessionCookieHeader(normalizedSession, now.getTime())
    if (!cookie) throw new XiaoYunqueAuthenticationError("XiaoYunque Web authorization is no longer valid")
    const lifetimeDays = options.lifetimeDays ?? 30
    if (!supportedLifetimeDays.has(lifetimeDays)) {
      throw new XiaoYunqueInputError("XiaoYunque Access Key lifetime is invalid")
    }
    const name = boundedText(options.name ?? "shortdrama-router", "XiaoYunque Access Key name", 64)
    const description = boundedText(
      options.description ?? "Created by shortdrama-router after local user authorization.",
      "XiaoYunque Access Key description",
      200,
    )
    const expiresAtSeconds = Math.floor((now.getTime() + lifetimeDays * 24 * 60 * 60_000) / 1_000)
    const data = await requestEnvelope(this.#fetch, new URL(generateAccessKeyPath, this.#baseUrl), {
      body: JSON.stringify({
        expired_at: expiresAtSeconds,
        token_desc: description,
        token_name: name,
      }),
      headers: {
        Accept: "application/json",
        appid: "795647",
        appvr: "1.1.4",
        Cookie: cookie,
        "Content-Type": "application/json",
        "entrance-from": "web",
        pf: "7",
      },
      method: "POST",
    }, signal)
    return {
      accessKey: requireString(data.ak, "XiaoYunque Access Key"),
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
      tokenId: typeof data.token_id === "string" ? data.token_id : undefined,
    }
  }
}
