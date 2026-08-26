/**
 * Resolver for Pi Work's per-instance data root.
 *
 * All server-side state — config.yaml, every SQLite DB, channel
 * credentials, session-name sidecars, agent-todo rows, profile files,
 * logs and lock files — lives under a single data root. The default is
 * `~/.pi-work`, but running more than one pi-work process against the
 * same root (e.g. a production `next start` plus a `next dev` on the
 * same checkout) makes background loops (scheduler / RSS / channel
 * workers) and SQLite/JSON stores race each other: duplicate scheduled
 * runs, duplicated channel pollers, lost updates on JSON files.
 *
 * Setting `PI_WORK_DATA_DIR` points the whole instance at a different
 * root, isolating every piece of state at once:
 *
 *   PI_WORK_DATA_DIR=~/.pi-work-dev next dev
 *
 * The per-DB overrides (`PI_WORK_SCHEDULER_DB`, `PI_WORK_TODOS_DB`, …)
 * still take precedence over this root when both are set, so a single
 * file can be redirected independently.
 *
 * This module is server-only: it imports `fs`/`path` and must never be
 * pulled into a client bundle or `lib/shared`.
 */
import { homedir } from "os";
import { join } from "path";

export const DEFAULT_DATA_DIR = join(homedir(), ".pi-work");

/** Resolve the per-instance data root. Falls back to `~/.pi-work`. */
export function getDataDir(): string {
  const override = process.env.PI_WORK_DATA_DIR?.trim();
  if (override) return override;
  return DEFAULT_DATA_DIR;
}

/** Resolve a path inside the per-instance data root. */
export function dataPath(...parts: string[]): string {
  return join(getDataDir(), ...parts);
}