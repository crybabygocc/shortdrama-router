import type {
  ImageJobStore,
  StoredImageJob,
  StoredVideoJob,
  VideoJobStore,
} from "./types.js"

function cloneStoredImageJob(value: StoredImageJob): StoredImageJob {
  return structuredClone(value)
}

function cloneStoredJob(value: StoredVideoJob): StoredVideoJob {
  return structuredClone(value)
}

export class MemoryVideoJobStore implements VideoJobStore {
  readonly #jobs = new Map<string, StoredVideoJob>()

  async get(id: string) {
    const value = this.#jobs.get(id)
    return value === undefined ? undefined : cloneStoredJob(value)
  }

  async put(value: StoredVideoJob) {
    this.#jobs.set(value.job.id, cloneStoredJob(value))
  }
}

export class MemoryImageJobStore implements ImageJobStore {
  readonly #jobs = new Map<string, StoredImageJob>()

  async get(id: string) {
    const value = this.#jobs.get(id)
    return value === undefined ? undefined : cloneStoredImageJob(value)
  }

  async put(value: StoredImageJob) {
    this.#jobs.set(value.job.id, cloneStoredImageJob(value))
  }
}
