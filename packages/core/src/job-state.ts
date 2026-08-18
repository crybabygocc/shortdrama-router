import { conflict } from "./errors.js"
import type { GenerationJobStatus } from "./types.js"

const terminal = new Set<GenerationJobStatus>(["completed", "failed", "cancelled"])

const transitions: Readonly<Record<GenerationJobStatus, ReadonlySet<GenerationJobStatus>>> = {
  submitting: new Set(["queued", "in_progress", "completed", "failed", "cancelled", "submission_unknown"]),
  submission_unknown: new Set(["queued", "in_progress", "completed", "failed"]),
  queued: new Set(["in_progress", "completed", "failed", "cancelled", "submission_unknown"]),
  in_progress: new Set(["completed", "failed", "cancelled", "submission_unknown"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

export function isTerminalStatus(status: GenerationJobStatus) {
  return terminal.has(status)
}

export function assertStatusTransition(from: GenerationJobStatus, to: GenerationJobStatus) {
  if (from === to || transitions[from].has(to)) return
  throw conflict(`generation job cannot transition from ${from} to ${to}`, "invalid_job_transition")
}
