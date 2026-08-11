"use client";

import { useSyncExternalStore } from "react";
import type { ShowFileEntry } from "@/lib/show-file-tool-types";

/**
 * Runtime-only cache of `show_file` tool results.
 *
 * `useAgentSession` populates this in its `tool_execution_end` handler by
 * extracting `event.result.details.files` (the `ShowFileDetails` payload
 * the server attaches to the tool result). The Session Library modal reads
 * it to render success / failure / "Loading…" states correctly.
 *
 * Not persisted across page reloads — `lib/session-reader.ts` strips the
 * `details` field when reconstructing `AgentMessage[]` from `.jsonl`, so
 * entries show in a pending state until the user re-runs a turn that
 * touches them.
 *
 * `resetShowFileResults()` is called on session / cwd / new-session
 * transitions (see `useAgentSession`'s reset effect).
 */

let resultsByToolCallId: Map<string, readonly ShowFileEntry[]> = new Map();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReadonlyMap<string, readonly ShowFileEntry[]> {
  return resultsByToolCallId;
}

function getServerSnapshot(): ReadonlyMap<string, readonly ShowFileEntry[]> {
  return EMPTY_MAP;
}

const EMPTY_MAP: ReadonlyMap<string, readonly ShowFileEntry[]> = new Map();

export function useShowFileResults(): ReadonlyMap<string, readonly ShowFileEntry[]> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Store one show_file tool result. Idempotent — last write wins. */
export function setShowFileResult(toolCallId: string, files: readonly ShowFileEntry[]): void {
  const next = new Map(resultsByToolCallId);
  next.set(toolCallId, files);
  resultsByToolCallId = next;
  emit();
}

export function resetShowFileResults(): void {
  resultsByToolCallId = new Map();
  emit();
}