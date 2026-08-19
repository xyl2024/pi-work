// Client-safe types + defaults for the agent retry settings UI.
//
// Mirrors the SDK's `RetrySettings` interface from
// `@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts:13-23`
// and the SDK's defaults from
// `@earendil-works/pi-coding-agent/dist/core/settings-manager.js:540-572`.
//
// Kept in a separate file from `lib/agent-settings.ts` because that
// module imports `fs` and `getAgentDir` (server-only). The Settings
// modal is a `"use client"` component — importing `fs` through it
// breaks webpack's client bundle. The project's convention
// (`lib/file-viewer-limits.ts` ↔ `lib/config.ts`,
// `lib/show-file-tool-types.ts` ↔ `lib/show-file-tool.ts`) is to keep
// pure types + constants in a sibling file. Server code re-imports the
// types from here if it wants to share them; the runtime I/O stays in
// `agent-settings.ts`.

export interface ProviderRetryConfig {
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
}

export interface AgentRetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  provider: ProviderRetryConfig;
}

// SDK defaults — see getRetrySettings() / getProviderRetrySettings()
// in node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js.
export const DEFAULT_AGENT_RETRY: AgentRetryConfig = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  provider: {
    maxRetryDelayMs: 60000,
  },
};

// UI input ranges — duplicated on the server in
// app/api/agent-settings/retry/route.ts#LIMITS. Keep them in sync.
export const RETRY_LIMITS = {
  maxRetries: { min: 0, max: 10 },
  baseDelayMs: { min: 100, max: 60_000 },
  provider: {
    timeoutMs: { min: 1_000, max: 3_600_000 },
    maxRetries: { min: 0, max: 10 },
    // 0 is legal — docs/settings.md:148 says "Set it to 0 to disable
    // the limit". Lower bound is 0, not 1.
    maxRetryDelayMs: { min: 0, max: 300_000 },
  },
} as const;

/**
 * Render the baseDelayMs → "{seconds}s, {seconds2}s, …" preview the
 * SDK uses (delayMs = baseDelayMs * 2^(attempt-1)). Truncates after
 * 3 entries so the preview fits the modal width; the actual SDK
 * sequence can be longer for maxRetries > 4.
 */
export function formatBackoffPreview(baseDelayMs: number, maxRetries: number): {
  shown: number[];
  total: number;
} {
  const total = Math.max(0, Math.floor(maxRetries));
  const all: number[] = [];
  for (let i = 0; i < total; i++) {
    all.push(Math.round((baseDelayMs * 2 ** i) / 1000));
  }
  return { shown: all.slice(0, 3), total };
}