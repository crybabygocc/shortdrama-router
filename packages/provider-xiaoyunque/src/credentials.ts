export const XIAOYUNQUE_COOKIE_ORIGIN = "https://xyq.jianying.com"
export const XIAOYUNQUE_SESSION_COOKIE_NAMES = [
  "sessionid_pippitcn_web",
  "sessionid_ss_pippitcn_web",
] as const

const allowedCookieNames: ReadonlySet<string> = new Set(XIAOYUNQUE_SESSION_COOKIE_NAMES)

export interface XiaoYunqueWebSessionCookie {
  readonly expires_at?: string
  readonly name: string
  readonly value: string
}

export interface XiaoYunqueWebSession {
  readonly authorized_at: string
  readonly cookies: readonly XiaoYunqueWebSessionCookie[]
}

export interface XiaoYunqueCredentialSnapshot {
  readonly access_key?: string
  readonly access_key_expires_at?: string
  readonly web_session?: XiaoYunqueWebSession
}

export interface XiaoYunqueCredentialSource {
  clear?(): Promise<void>
  read(): Promise<XiaoYunqueCredentialSnapshot>
  setAccessKey?(accessKey: string, expiresAt?: string): Promise<void>
  setWebSession?(session: XiaoYunqueWebSession): Promise<void>
}

function normalizeAccessKey(value: string | undefined) {
  if (value === undefined || value.trim() === "") return undefined
  const normalized = value.trim()
  if (normalized.length > 8_192 || /[\u0000-\u0020\u007f]/u.test(normalized)) {
    throw new Error("XiaoYunque Access Key is invalid")
  }
  return normalized
}

export function normalizeWebSession(session: XiaoYunqueWebSession | undefined) {
  if (session === undefined) return undefined
  const authorizedAt = new Date(session.authorized_at)
  if (Number.isNaN(authorizedAt.getTime())) throw new Error("XiaoYunque Web session is invalid")
  if (session.cookies.length === 0 || session.cookies.length > XIAOYUNQUE_SESSION_COOKIE_NAMES.length) {
    throw new Error("XiaoYunque Web session is invalid")
  }
  const names = new Set<string>()
  const cookies = session.cookies.map(cookie => {
    if (
      !allowedCookieNames.has(cookie.name)
      || names.has(cookie.name)
      || cookie.value.length === 0
      || Buffer.byteLength(cookie.value, "utf8") > 16 * 1024
      || /[\u0000-\u0020\u007f;]/u.test(cookie.value)
    ) {
      throw new Error("XiaoYunque Web session Cookie is invalid")
    }
    names.add(cookie.name)
    if (cookie.expires_at !== undefined && Number.isNaN(new Date(cookie.expires_at).getTime())) {
      throw new Error("XiaoYunque Web session expiry is invalid")
    }
    return { ...cookie }
  })
  return { authorized_at: authorizedAt.toISOString(), cookies } satisfies XiaoYunqueWebSession
}

export class MemoryXiaoYunqueCredentials implements XiaoYunqueCredentialSource {
  #snapshot: XiaoYunqueCredentialSnapshot

  constructor(snapshot: XiaoYunqueCredentialSnapshot = {}) {
    const accessKey = normalizeAccessKey(snapshot.access_key)
    const accessKeyExpiresAt = snapshot.access_key_expires_at
    if (accessKeyExpiresAt !== undefined && (accessKey === undefined || Number.isNaN(new Date(accessKeyExpiresAt).getTime()))) {
      throw new Error("XiaoYunque Access Key expiry is invalid")
    }
    const webSession = normalizeWebSession(snapshot.web_session)
    this.#snapshot = {
      ...(accessKey === undefined ? {} : { access_key: accessKey }),
      ...(accessKeyExpiresAt === undefined ? {} : { access_key_expires_at: new Date(accessKeyExpiresAt).toISOString() }),
      ...(webSession === undefined ? {} : { web_session: webSession }),
    }
  }

  async read() {
    return structuredClone(this.#snapshot)
  }

  async setAccessKey(accessKey: string, expiresAt?: string) {
    const normalized = normalizeAccessKey(accessKey)
    if (normalized === undefined) throw new Error("XiaoYunque Access Key is invalid")
    if (expiresAt !== undefined && Number.isNaN(new Date(expiresAt).getTime())) {
      throw new Error("XiaoYunque Access Key expiry is invalid")
    }
    const { access_key: _accessKey, access_key_expires_at: _accessKeyExpiresAt, ...rest } = this.#snapshot
    this.#snapshot = {
      ...rest,
      access_key: normalized,
      ...(expiresAt === undefined ? {} : { access_key_expires_at: new Date(expiresAt).toISOString() }),
    }
  }

  async setWebSession(session: XiaoYunqueWebSession) {
    const normalized = normalizeWebSession(session)
    if (normalized === undefined) throw new Error("XiaoYunque Web session is invalid")
    this.#snapshot = { ...this.#snapshot, web_session: normalized }
  }

  async clear() {
    this.#snapshot = {}
  }
}

export function webSessionExpiry(session: XiaoYunqueWebSession) {
  const expiries = session.cookies
    .flatMap(cookie => cookie.expires_at === undefined ? [] : [new Date(cookie.expires_at).getTime()])
  return expiries.length === 0 ? undefined : Math.min(...expiries)
}

export function webSessionCookieHeader(session: XiaoYunqueWebSession, now = Date.now()) {
  return session.cookies
    .filter(cookie => cookie.expires_at === undefined || new Date(cookie.expires_at).getTime() > now)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join("; ")
}
