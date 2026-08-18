import type { ProviderResource } from "@shortdrama-router/core"

export interface LibTvConfigurationSnapshot {
  readonly project?: ProviderResource
}

export interface LibTvConfigurationSource {
  clear?(): Promise<void>
  read(): Promise<LibTvConfigurationSnapshot>
  write?(snapshot: LibTvConfigurationSnapshot): Promise<void>
}

export class MemoryLibTvConfiguration implements LibTvConfigurationSource {
  #snapshot: LibTvConfigurationSnapshot

  constructor(snapshot: LibTvConfigurationSnapshot = {}) {
    this.#snapshot = structuredClone(snapshot)
  }

  async clear() {
    this.#snapshot = {}
  }

  async read() {
    return structuredClone(this.#snapshot)
  }

  async write(snapshot: LibTvConfigurationSnapshot) {
    this.#snapshot = structuredClone(snapshot)
  }
}
