/**
 * Context-window occupancy for a Kanban task's linked session.
 *
 * This is the exact same number pi draws in the chat top-bar circle
 * (`AgentSessionWrapper.getContextUsage()`): estimated context tokens over
 * the model's context window. Kanban cards and the chat share the same
 * `sessionId`, so we reuse that source:
 *
 *   1. If the session's `AgentSessionWrapper` is currently alive in-process,
 *      call its live `getContextUsage()` — byte-for-byte identical to the
 *      chat circle, and cheap.
 *   2. Otherwise (server restarted / wrapper reaped) fall back to deriving it
 *      from the session JSONL, mirroring pi's `getContextUsage()` logic via
 *      the same exported primitives (`buildSessionContext`,
 *      `estimateTokens`, `calculateContextTokens`, `getLatestCompactionEntry`)
 *      so the number stays consistent whether the wrapper is mounted or not.
 *
 * The board polls /api/kanban every few seconds, so like the card stats this
 * is cached per JSONL mtime — an unchanged file is never re-parsed. The
 * provider/model → contextWindow lookup is also cached (the model set rarely
 * changes mid-session, and spinning up a full `ModelRuntime` per task per poll
 * would be wasteful).
 */

import { SessionManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, estimateTokens, calculateContextTokens, getLatestCompactionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@/lib/shared/types";
import { getRpcSession } from "@/lib/server/session-registry";
import { resolveSessionPath } from "@/lib/server/sessions/reader";
import type { KanbanContextUsage } from "@/lib/shared/kanban-types";

interface ContextUsageCacheEntry {
  mtimeMs: number;
  usage: KanbanContextUsage | null;
}

declare global {
  var __piKanbanContextCache: Map<string, ContextUsageCacheEntry> | undefined;
  var __piModelWindowCache: Map<string, number | undefined> | undefined;
}

function getContextCache(): Map<string, ContextUsageCacheEntry> {
  globalThis.__piKanbanContextCache ??= new Map();
  return globalThis.__piKanbanContextCache;
}

function getModelWindowCache(): Map<string, number | undefined> {
  globalThis.__piModelWindowCache ??= new Map();
  return globalThis.__piModelWindowCache;
}

/** Resolve a provider/modelId to its declared context window, cached. Returns
 *  undefined when the model (or a window) can't be resolved. */
async function resolveContextWindow(
  provider: string | null | undefined,
  modelId: string | null | undefined,
): Promise<number | undefined> {
  if (!provider || !modelId) return undefined;
  const key = `${provider}\u0000${modelId}`;
  const cache = getModelWindowCache();
  if (cache.has(key)) return cache.get(key);

  let window: number | undefined;
  try {
    const runtime = await ModelRuntime.create();
    const model = runtime
      .getModels()
      .find((m) => m.provider === provider && m.id === modelId);
    window = model && typeof model.contextWindow === "number" ? model.contextWindow : undefined;
  } catch {
    window = undefined;
  }
  cache.set(key, window);
  return window;
}

// ── Mirror of pi's (non-exported) estimateContextTokens: the last assistant
// use block's context tokens plus a character-count estimate for any messages
// streamed after it. When no assistant has reported usage yet, fall back to a
// pure estimate. Messages here are the compacted context messages from
// `buildSessionContext`, which is what getContextUsage()'s `this.messages`
// holds too.
function estimateContextTokens(messages: AgentMessage[]): number {
  let lastUsage: unknown = null;
  let lastUsageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const usage = (msg as { usage?: unknown }).usage;
    if (
      msg.role === "assistant" &&
      msg.stopReason !== "aborted" &&
      msg.stopReason !== "error" &&
      usage &&
      calculateContextTokens(usage as never) > 0
    ) {
      lastUsage = usage;
      lastUsageIndex = i;
      break;
    }
  }
  if (lastUsageIndex === -1) {
    let estimated = 0;
    for (const m of messages) estimated += estimateTokens(m as never);
    return estimated;
  }
  const usageTokens = calculateContextTokens(lastUsage as never);
  let trailing = 0;
  for (let i = lastUsageIndex + 1; i < messages.length; i++) {
    trailing += estimateTokens(messages[i] as never) as number;
  }
  return usageTokens + trailing;
}

/** Derive context usage purely from the session JSONL (no live wrapper),
 *  mirroring `AgentSession.getContextUsage()`. Returns null when the session
 *  can't be read or the model window is unknown. */
async function contextUsageFromJsonl(
  sessionId: string,
  provider: string | null | undefined,
  modelId: string | null | undefined,
): Promise<KanbanContextUsage | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  let mtimeMs = 0;
  try {
    mtimeMs = (await import("fs")).statSync(filePath).mtimeMs;
  } catch {
    return null;
  }

  const cache = getContextCache();
  const cached = cache.get(sessionId);
  if (cached && cached.mtimeMs === mtimeMs) return cached.usage;

  let usage: KanbanContextUsage | null = null;
  try {
    const sm = SessionManager.open(filePath);
    const ctx = buildSessionContext(sm.getEntries() as never, sm.getLeafId() as never);
    const messages = ctx.messages as unknown as AgentMessage[];

    // Context window comes from the session's model. For a finished session
    // the model resolved from the session itself (ctx.model — the last
    // assistant message / model_change) is the ground truth of what was used;
    // fall back to the task row's recorded provider/modelId when unavailable.
    const sessionModel = ctx.model as { provider?: string; modelId?: string } | undefined;
    const contextWindow = await resolveContextWindow(
      sessionModel?.provider ?? provider ?? null,
      sessionModel?.modelId ?? modelId ?? null,
    );
    if (!contextWindow || contextWindow <= 0) {
      usage = null;
    } else {
      // Post-compaction guard mirroring getContextUsage(): before the first
      // assistant that replied after the latest compaction, the true context
      // size is unknown until the next LLM response.
      const branch = sm.getBranch() as never[];
      const latestCompaction = getLatestCompactionEntry(branch as never);
      let percentUnknown = false;
      if (latestCompaction) {
        const compactionIndex = (branch as unknown[]).lastIndexOf(latestCompaction as never);
        let hasPostCompactionUsage = false;
        for (let i = branch.length - 1; i > compactionIndex; i--) {
          const entry = branch[i] as { type?: string; message?: AgentMessage };
          if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
          const asst = entry.message;
          if (asst.stopReason !== "aborted" && asst.stopReason !== "error" && asst.usage) {
            if (calculateContextTokens(asst.usage as never) > 0) {
              hasPostCompactionUsage = true;
              break;
            }
          }
        }
        percentUnknown = !hasPostCompactionUsage;
      }

      if (percentUnknown) {
        usage = { tokens: null, contextWindow, percent: null };
      } else {
        const tokens = estimateContextTokens(messages);
        usage = {
          tokens,
          contextWindow,
          percent: (tokens / contextWindow) * 100,
        };
      }
    }
  } catch {
    usage = null;
  }

  cache.set(sessionId, { mtimeMs, usage });
  return usage;
}

/**
 * Context-window occupancy for a task's linked session (chat-circle data).
 * Prefers the live wrapper's `getContextUsage()`; falls back to a JSONL-derived
 * estimate. Returns null for backlog cards / unknown sessions.
 */
export async function readKanbanContextUsage(
  sessionId: string,
  provider?: string | null,
  modelId?: string | null,
): Promise<KanbanContextUsage | null> {
  const wrapper = getRpcSession(sessionId);
  if (wrapper?.isAlive()) {
    const live = wrapper.getContextUsage();
    if (live) return live;
  }
  return contextUsageFromJsonl(sessionId, provider ?? null, modelId ?? null);
}