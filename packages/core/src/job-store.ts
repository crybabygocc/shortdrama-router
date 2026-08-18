import type {
  AudioJobStore,
  ImageJobStore,
  StoredAudioJob,
  StoredImageJob,
  StoredVideoJob,
  VideoJobStore,
} from "./types.js"
import { conflict } from "./errors.js"

function cloneStoredAudioJob(value: StoredAudioJob): StoredAudioJob {
  return structuredClone(value)
}

function cloneStoredImageJob(value: StoredImageJob): StoredImageJob {
  return structuredClone(value)
}

function cloneStoredJob(value: StoredVideoJob): StoredVideoJob {
  return structuredClone(value)
}

export class MemoryVideoJobStore implements VideoJobStore {
  readonly #jobs = new Map<string, StoredVideoJob>()
  readonly #idempotency = new Map<string, string>()

  async claim(value: StoredVideoJob) {
    const existing = claimed(this.#jobs, this.#idempotency, value)
    if (existing) return { created: false, value: cloneStoredJob(existing) }
    const created = { ...value, version: 1 }
    this.#jobs.set(value.job.id, cloneStoredJob(created))
    if (value.idempotency_key) this.#idempotency.set(value.idempotency_key, value.job.id)
    return { created: true, value: cloneStoredJob(created) }
  }

  async compareAndSet(id: string, expectedVersion: number, value: StoredVideoJob) {
    const current = this.#jobs.get(id)
    if (!current || current.version !== expectedVersion) return false
    this.#jobs.set(id, cloneStoredJob({ ...value, version: expectedVersion + 1 }))
    return true
  }

  async get(id: string) {
    const value = this.#jobs.get(id)
    return value === undefined ? undefined : cloneStoredJob(value)
  }

  async getByIdempotencyKey(key: string) {
    const id = this.#idempotency.get(key)
    return id === undefined ? undefined : this.get(id)
  }

  async put(value: StoredVideoJob) {
    const current = this.#jobs.get(value.job.id)
    this.#jobs.set(value.job.id, cloneStoredJob({ ...value, version: value.version ?? (current?.version ?? 0) + 1 }))
    if (value.idempotency_key) this.#idempotency.set(value.idempotency_key, value.job.id)
  }
}

export class MemoryImageJobStore implements ImageJobStore {
  readonly #jobs = new Map<string, StoredImageJob>()
  readonly #idempotency = new Map<string, string>()

  async claim(value: StoredImageJob) {
    const existing = claimed(this.#jobs, this.#idempotency, value)
    if (existing) return { created: false, value: cloneStoredImageJob(existing) }
    const created = { ...value, version: 1 }
    this.#jobs.set(value.job.id, cloneStoredImageJob(created))
    if (value.idempotency_key) this.#idempotency.set(value.idempotency_key, value.job.id)
    return { created: true, value: cloneStoredImageJob(created) }
  }

  async compareAndSet(id: string, expectedVersion: number, value: StoredImageJob) {
    const current = this.#jobs.get(id)
    if (!current || current.version !== expectedVersion) return false
    this.#jobs.set(id, cloneStoredImageJob({ ...value, version: expectedVersion + 1 }))
    return true
  }

  async get(id: string) {
    const value = this.#jobs.get(id)
    return value === undefined ? undefined : cloneStoredImageJob(value)
  }

  async getByIdempotencyKey(key: string) {
    const id = this.#idempotency.get(key)
    return id === undefined ? undefined : this.get(id)
  }

  async put(value: StoredImageJob) {
    const current = this.#jobs.get(value.job.id)
    this.#jobs.set(value.job.id, cloneStoredImageJob({ ...value, version: value.version ?? (current?.version ?? 0) + 1 }))
    if (value.idempotency_key) this.#idempotency.set(value.idempotency_key, value.job.id)
  }
}

export class MemoryAudioJobStore implements AudioJobStore {
  readonly #jobs = new Map<string, StoredAudioJob>()
  readonly #idempotency = new Map<string, string>()

  async claim(value: StoredAudioJob) {
    const existing = claimed(this.#jobs, this.#idempotency, value)
    if (existing) return { created: false, value: cloneStoredAudioJob(existing) }
    const created = { ...value, version: 1 }
    this.#jobs.set(value.job.id, cloneStoredAudioJob(created))
    if (value.idempotency_key) this.#idempotency.set(value.idempotency_key, value.job.id)
    return { created: true, value: cloneStoredAudioJob(created) }
  }

  async compareAndSet(id: string, expectedVersion: number, value: StoredAudioJob) {
    const current = this.#jobs.get(id)
    if (!current || current.version !== expectedVersion) return false
    this.#jobs.set(id, cloneStoredAudioJob({ ...value, version: expectedVersion + 1 }))
    return true
  }

  async get(id: string) {
    const value = this.#jobs.get(id)
    return value === undefined ? undefined : cloneStoredAudioJob(value)
  }

  async getByIdempotencyKey(key: string) {
    const id = this.#idempotency.get(key)
    return id === undefined ? undefined : this.get(id)
  }

  async put(value: StoredAudioJob) {
    const current = this.#jobs.get(value.job.id)
    this.#jobs.set(value.job.id, cloneStoredAudioJob({ ...value, version: value.version ?? (current?.version ?? 0) + 1 }))
    if (value.idempotency_key) this.#idempotency.set(value.idempotency_key, value.job.id)
  }
}

function claimed<T extends StoredAudioJob | StoredImageJob | StoredVideoJob>(
  jobs: Map<string, T>,
  idempotency: Map<string, string>,
  value: T,
) {
  const id = value.idempotency_key === undefined ? undefined : idempotency.get(value.idempotency_key)
  const existing = id === undefined ? jobs.get(value.job.id) : jobs.get(id)
  if (!existing) return undefined
  if (existing.request_hash !== value.request_hash) {
    throw conflict("idempotency key was already used with a different request", "idempotency_conflict")
  }
  return existing
}
