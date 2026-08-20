// Server-side helpers for reading/writing pi SDK's `~/.pi/agent/settings.json`.
//
// The pi coding agent reads this file at session-start (see
// `createAgentSession` in lib/rpc-manager.ts and
// `SettingsManager` in @earendil-works/pi-coding-agent). It owns many
// top-level keys (`defaultProvider`, `defaultModel`, `packages`,
// `theme`, `skills`, `enableSkillCommands`, …) and any of those may be
// added or renamed by future SDK versions. To avoid silently dropping
// them on round-trip, we treat the file as an opaque
// `Record<string, unknown>` and only type-safely handle the `retry`
// sub-section — that's the part the Settings modal owns.
//
// Atomic write: write to `<path>.tmp.<ts>` first, then `renameSync` to
// the real path. `renameSync` is atomic on POSIX (same filesystem) so a
// crash mid-write can never leave the real file truncated or empty —
// the original survives, and the stray `.tmp` is harmless.
//
// Async design: the SDK is ESM-only with a strict `exports` map, so a
// static `import` at module-load time fails in CJS-by-default
// environments (notably the `tsx`-based test harness). We lazy-load
// it via `Function("return import")(name)` so the resolution happens
// at call time. Both `readAgentRetry` and `writeAgentRetry` are
// therefore async — API routes `await` them, the test harness
// `await`s them. Production callers are already inside async route
// handlers, so this is a no-op for the consumer.

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createLogger } from "./logger";
import {
  DEFAULT_AGENT_RETRY,
  type AgentRetryConfig,
  type ProviderRetryConfig,
} from "../shared/agent-settings-types";

// Re-export the client-safe type module's symbols so existing imports
// (`import { type AgentRetryConfig } from "@/lib/agent-settings"`) keep
// working for server-side callers. UI code should import directly
// from `./agent-settings-types` to avoid pulling `fs` into the client
// bundle.
export { DEFAULT_AGENT_RETRY };
export type { AgentRetryConfig, ProviderRetryConfig };

const log = createLogger("agent-settings");

// ── Lazy SDK loader ────────────────────────────────────────────────────
// `new Function("return import")` returns the runtime's dynamic-
// import function — the only cross-context way to load an ESM-only
// module from either an ESM bundle (Next.js server components) or a
// CJS bundle (tsx in this repo's scripts/). A plain `require(...)`
// fails in the ESM context (`require is not defined`); a static
// `import` fails in the CJS context (no `default` export condition in
// the SDK's `exports`). Dynamic import works in both because the
// bundler/runtime handles the ESM↔CJS bridge at call time.
let _sdkModule: { getAgentDir: () => string } | null = null;
let _sdkLoading: Promise<void> | null = null;

function dynamicImport<T>(specifier: string): Promise<T> {
  // `Function` constructor keeps this out of any static-analysis path
  // that webpack/tsx would try to follow, AND keeps `require` /
  // `import` from being a syntactical reference (eslint allows this).
  const dynImport = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;
  return dynImport(specifier) as Promise<T>;
}

async function ensureSdkLoaded(): Promise<void> {
  if (_sdkModule !== null) return;
  if (_sdkLoading === null) {
    _sdkLoading = dynamicImport<{ getAgentDir: () => string }>("@earendil-works/pi-coding-agent")
      .then((m) => {
        _sdkModule = m;
      })
      .catch((err) => {
        log.warn("failed to load @earendil-works/pi-coding-agent; using env-var fallback only", {
          error: String(err),
        });
        // Clear so a future call retries — SDK may become available
        // later (e.g. lazy-installed peer dep).
        _sdkLoading = null;
      });
  }
  await _sdkLoading;
}

// Eagerly kick off the SDK load at module-import time. In production
// (Next.js), this Promise resolves well before the first user request
// reaches the API route. In the test harness `PI_CODING_AGENT_DIR`
// is set, so `getAgentSettingsPath()` never needs the SDK to load.
void ensureSdkLoaded();

// ── Parser helpers ─────────────────────────────────────────────────────
// Fail-open per field: missing or wrong-typed field → default. This
// matches `lib/config.ts` style and protects against partial writes,
// hand-edited YAMLs, or SDK additions.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseProviderRetry(raw: unknown): ProviderRetryConfig {
  if (!isPlainObject(raw)) return { ...DEFAULT_AGENT_RETRY.provider };
  const obj = raw;
  const out: ProviderRetryConfig = {};
  const t = obj.timeoutMs;
  if (typeof t === "number" && Number.isFinite(t) && t >= 0) out.timeoutMs = t;
  const r = obj.maxRetries;
  if (typeof r === "number" && Number.isFinite(r) && r >= 0) out.maxRetries = r;
  const d = obj.maxRetryDelayMs;
  if (typeof d === "number" && Number.isFinite(d) && d >= 0) out.maxRetryDelayMs = d;
  return out;
}

function parseRetry(raw: unknown): AgentRetryConfig {
  if (!isPlainObject(raw)) return { ...DEFAULT_AGENT_RETRY, provider: { ...DEFAULT_AGENT_RETRY.provider } };
  const obj = raw;
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_AGENT_RETRY.enabled,
    maxRetries: typeof obj.maxRetries === "number" && Number.isFinite(obj.maxRetries) && obj.maxRetries >= 0
      ? obj.maxRetries
      : DEFAULT_AGENT_RETRY.maxRetries,
    baseDelayMs: typeof obj.baseDelayMs === "number" && Number.isFinite(obj.baseDelayMs) && obj.baseDelayMs >= 0
      ? obj.baseDelayMs
      : DEFAULT_AGENT_RETRY.baseDelayMs,
    provider: parseProviderRetry(obj.provider),
  };
}

// ── Path resolver ──────────────────────────────────────────────────────
// Async because the SDK is loaded via dynamic import. Production
// path: prefer `PI_CODING_AGENT_DIR` env var if set (so the test
// harness can sandbox reads/writes without module hooks); otherwise
// call `getAgentDir()` from the SDK; final fallback is the literal
// `~/.pi/agent` (used when the SDK import fails AND no env var is
// set — extremely unlikely in production).

export async function getAgentSettingsPath(): Promise<string> {
  // 1. Env var (test harness + power-user override). Honoured even
  //    when the SDK is loaded, so a sandbox can point it anywhere.
  if (process.env.PI_CODING_AGENT_DIR) {
    return join(process.env.PI_CODING_AGENT_DIR, "settings.json");
  }
  // 2. SDK's resolver.
  await ensureSdkLoaded();
  if (_sdkModule !== null) {
    return join(_sdkModule.getAgentDir(), "settings.json");
  }
  // 3. Hard fallback (SDK import failed AND no env var). The path
  //    probably doesn't exist on disk, but `readRawSettings` handles
  //    that gracefully (returns {} and lets the caller fall back to
  //    defaults).
  return join(homedir(), ".pi", "agent", "settings.json");
}

// ── I/O ────────────────────────────────────────────────────────────────

async function readRawSettings(): Promise<Record<string, unknown>> {
  const path = await getAgentSettingsPath();
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    log.warn("failed to read agent settings, treating as empty", { path, error: String(err) });
    return {};
  }
  // Empty file is tolerated — treat as {} (matches `lib/config.ts`
  // empty-yaml behaviour). Malformed JSON is logged but NOT modified
  // on disk — the caller falls back to defaults and the next PUT will
  // overwrite the bad file with a valid one (atomic write preserves
  // the broken file only if no write happens).
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  try {
    const parsed = JSON.parse(trimmed);
    return isPlainObject(parsed) ? parsed : {};
  } catch (err) {
    log.warn("agent settings json malformed; returning defaults without modifying file", {
      path,
      error: String(err),
    });
    return {};
  }
}

async function writeRawSettingsAtomic(next: Record<string, unknown>): Promise<void> {
  const path = await getAgentSettingsPath();
  const tmpPath = `${path}.tmp.${Date.now()}`;
  // Use homedir-relative `.bak` so a one-line shell recovery is
  // possible: `mv ~/.pi/agent/settings.json.bak.<ts> ~/.pi/agent/settings.json`.
  // The backup is taken *before* the new file is committed; if the
  // rename ever fails (extremely rare on the same fs), the original
  // survives as `.bak` and the `.tmp` can be discarded.
  const backupPath = `${path}.bak.${Date.now()}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(next, null, 2) + "\n", "utf8");
    // Snapshot the previous contents only after the temp write
    // succeeds — if writeFileSync threw, we never want to clobber the
    // backup with a stale copy.
    if (existsSync(path)) {
      try {
        const prev = readFileSync(path, "utf8");
        writeFileSync(backupPath, prev, "utf8");
      } catch (err) {
        // Backup is best-effort. If reading the original fails (race
        // with another writer), skip the backup — the atomic rename
        // still protects the user from a corrupted file.
        log.warn("could not snapshot pre-write backup", { backupPath, error: String(err) });
      }
    }
    renameSync(tmpPath, path);
    log.info("agent settings written", {
      path,
      hadBackup: existsSync(backupPath),
      keys: Object.keys(next),
    });
  } catch (err) {
    log.error("agent settings write failed", { path, tmpPath, error: String(err) });
    // Best-effort cleanup of the temp file so it doesn't accumulate.
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Read the `retry` sub-section. Always returns a fully-populated
 * `AgentRetryConfig` (defaults fill in any missing/invalid field).
 * Never writes to disk.
 */
export async function readAgentRetry(): Promise<AgentRetryConfig> {
  const raw = await readRawSettings();
  return parseRetry(raw.retry);
}

/**
 * Write the `retry` sub-section while preserving every other
 * top-level key (defaultProvider, packages, skills, theme, …).
 * Uses an atomic rename so a crash mid-write cannot corrupt the file.
 *
 * Returns the full settings object as written (for logging / tests).
 */
export async function writeAgentRetry(next: AgentRetryConfig): Promise<Record<string, unknown>> {
  const current = await readRawSettings();
  const merged: Record<string, unknown> = {
    ...current,
    retry: serializeRetry(next),
  };
  await writeRawSettingsAtomic(merged);
  return merged;
}

function serializeRetry(retry: AgentRetryConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    enabled: retry.enabled,
    maxRetries: retry.maxRetries,
    baseDelayMs: retry.baseDelayMs,
  };
  // Only emit provider fields the user actually set. An empty
  // provider block (`{}`) is the same as no provider block — leaving
  // SDK defaults (timeoutMs=SDK default, maxRetries=0,
  // maxRetryDelayMs=60000) intact. 0 is a valid explicit value for
  // maxRetryDelayMs (means "disable the server-requested-delay cap",
  // per docs/settings.md:148), so we must emit it when set.
  const provider: Record<string, unknown> = {};
  if (typeof retry.provider.timeoutMs === "number") provider.timeoutMs = retry.provider.timeoutMs;
  if (typeof retry.provider.maxRetries === "number") provider.maxRetries = retry.provider.maxRetries;
  if (typeof retry.provider.maxRetryDelayMs === "number") provider.maxRetryDelayMs = retry.provider.maxRetryDelayMs;
  if (Object.keys(provider).length > 0) out.provider = provider;
  return out;
}

// Exposed for the Settings modal's "Reset to defaults" action.
export async function resetAgentRetry(): Promise<Record<string, unknown>> {
  const current = await readRawSettings();
  // `reset` means "drop the override entirely" — the SDK will fall
  // back to its built-in defaults. We achieve that by *removing* the
  // `retry` key rather than writing `DEFAULT_AGENT_RETRY` (which
  // would be a custom override rather than a reset).
  const { retry: _drop, ...rest } = current;
  void _drop;
  await writeRawSettingsAtomic(rest);
  return rest;
}