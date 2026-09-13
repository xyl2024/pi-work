/**
 * `pi_work_call` — dispatcher for Pi Work platform capabilities.
 *
 * Consolidates the former `pi_work_get_sessions_id`,
 * `pi_work_get_active_sessions_id` and `pi_work_get_session_info_by_id`
 * tools into ONE tool so the platform tool descriptions don't flood the
 * system prompt. Deeper guidance is meant to be provided later by a
 * pi-work platform skill (progressive disclosure), so this tool carries no
 * appended system-prompt block — only its description.
 *
 * Actions (all read-only):
 * - `list_recent_sessions`  — most recently modified sessions (disk-backed).
 * - `list_active_sessions`  — ids of sessions currently loaded in memory
 *   (the `__piSessions` registry) + which are running.
 * - `get_session_info`      — disk-backed detail for one session id (name,
 *   cwd, timestamps, first/last messages, model, thinking level, token
 *   usage, compaction history).
 *
 * Implementation is derived from existing server modules:
 *   - live set + running state: lib/server/session-registry.ts
 *   - disk session detail:      lib/server/session-reader.ts (readSessionDetails)
 *
 * These tools are intentionally READ-ONLY: the agent can inspect Pi Work
 * sessions but never mutate them. Gated via TOOL_MARKET_IDS and only
 * registered inside pi-work sessions (rpc-manager.ts). Because they read
 * server state, this module is server-only and must not be imported by
 * client code.
 */

import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { listAllSessionsHeaderOnly, readSessionDetails } from "@/lib/server/session-reader";
import { getRpcSession, listRunningRpcSessions } from "@/lib/server/session-registry";
import type { AgentMessage, AssistantMessage, SessionContext } from "@/lib/shared/types";

export const PI_WORK_CALL_TOOL = "pi_work_call";

export type PiWorkCallAction = "list_recent_sessions" | "list_active_sessions" | "get_session_info";

/** Cap on the amount of message text / compaction summary surfaced to the
 *  model per call, so a busy session can't blow out the tool result. */
const MAX_TEXT = 2000;

function truncate(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

/** Render a message's textual content (string or content blocks). */
function messageText(msg: AgentMessage): string {
  const content = (msg as { content: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const parts = content
      .filter((block) => typeof block === "object" && block !== null && (block as { type?: string }).type === "text")
      .map((block) => (block as { text?: unknown }).text)
      .filter((t): t is string => typeof t === "string");
    return parts.join("\n").trim();
  }
  return "";
}

// ============================================================================
// list_recent_sessions
// ============================================================================

interface RecentSessionSummary {
  id: string;
  name: string;
  firstUserMessage: string;
}

interface ListRecentSessionsDetails {
  action: "list_recent_sessions";
  sessions: RecentSessionSummary[];
  limit: number;
  count: number;
}

async function listRecentSessions(limit = 10) {
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const sessions = (await listAllSessionsHeaderOnly()).slice(0, normalizedLimit).map((session) => ({
    id: session.id,
    name: session.name ?? "",
    firstUserMessage: truncate(session.firstMessage ?? ""),
  }));
  const details: ListRecentSessionsDetails = { action: "list_recent_sessions", sessions, limit: normalizedLimit, count: sessions.length };
  const text = sessions.length === 0
    ? "No sessions found."
    : `Recent sessions (${sessions.length}):\n${sessions.map((s, i) => `${i + 1}. id=${s.id}\n   name=${s.name || "(unnamed)"}\n   firstUserMessage=${s.firstUserMessage || "(none)"}`).join("\n")}`;
  return { content: [{ type: "text" as const, text }], details };
}

// ============================================================================
// list_active_sessions
// ============================================================================

interface ListActiveSessionsDetails {
  action: "list_active_sessions";
  sessionIds: string[];
  running: string[];
  count: number;
}

function listActiveSessions() {
  const entries = listRunningRpcSessions();
  const sessionIds = entries.map((e) => e.id);
  const running = entries.filter((e) => e.running).map((e) => e.id);
  const count = sessionIds.length;

  const lines = entries.map((e) => `- ${e.id}${e.running ? " (running)" : ""}`);
  const text =
    count === 0
      ? "No sessions are currently loaded in memory."
      : `Active sessions in memory (${count})${running.length ? `, ${running.length} running` : ""}:\n${lines.join("\n")}`;

  return { content: [{ type: "text" as const, text }], details: { action: "list_active_sessions", sessionIds, running, count } satisfies ListActiveSessionsDetails };
}

// ============================================================================
// get_session_info
// ============================================================================

interface CompactionInfo {
  count: number;
  lastTokensBefore: number | null;
  lastSummary: string | null;
}

interface GetSessionInfoDetails {
  action: "get_session_info";
  sessionId: string;
  sessionName: string;
  cwd: string;
  created: string | null;
  modified: string | null;
  messageCount: number;
  model: { provider: string; modelId: string } | null;
  thinkingLevel: string;
  firstUserMessage: string;
  lastAssistantMessage: string;
  lastAssistantStatus: { stopReason: string | null; error: string | null };
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
  };
  compaction: CompactionInfo;
  parentSessionId: string | undefined;
  alive: boolean;
  running: boolean;
  /** Set to "not_found" when the session id does not exist. */
  error?: string;
}

function sessionInfoPayload(
  sessionId: string,
  details: Awaited<ReturnType<typeof readSessionDetails>>,
): GetSessionInfoDetails {
  const wrapper = getRpcSession(sessionId);
  const alive = wrapper?.isAlive() ?? false;
  const running = wrapper?.isRunning() ?? false;
  const info = details?.info ?? null;
  const context: SessionContext =
    details?.context ?? {
      messages: [] as AgentMessage[],
      entryIds: [],
      entryTimestamps: [],
      thinkingLevel: "off",
      model: null,
      compactionPoints: [],
    };

  const messages = context.messages ?? [];
  const firstUser = messages.find((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant") as AssistantMessage | undefined;

  // Aggregate token usage across assistant messages.
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const u = (msg as AssistantMessage).usage;
    if (!u) continue;
    input += u.input ?? 0;
    output += u.output ?? 0;
    cacheRead += u.cacheRead ?? 0;
    cacheWrite += u.cacheWrite ?? 0;
    cost += u.cost?.total ?? 0;
  }

  const points = context.compactionPoints ?? [];
  const lastPoint = points[points.length - 1];

  return {
    action: "get_session_info",
    sessionId,
    sessionName: info?.name ?? "",
    cwd: info?.cwd ?? "",
    created: info?.created ?? null,
    modified: info?.modified ?? null,
    messageCount: info?.messageCount ?? messages.length,
    model: context.model ?? null,
    thinkingLevel: context.thinkingLevel ?? "off",
    firstUserMessage: firstUser ? truncate(messageText(firstUser)) : "",
    lastAssistantMessage: lastAssistant ? truncate(messageText(lastAssistant)) : "",
    lastAssistantStatus: {
      stopReason: lastAssistant?.stopReason ?? null,
      error: lastAssistant?.errorMessage ?? null,
    },
    totalUsage: {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cost,
    },
    compaction: {
      count: points.length,
      lastTokensBefore: lastPoint?.tokensBefore ?? null,
      lastSummary: lastPoint ? truncate(lastPoint.summary) : null,
    },
    parentSessionId: info?.parentSessionId,
    alive,
    running,
  };
}

function sessionInfoText(d: GetSessionInfoDetails): string {
  const model = d.model ? `${d.model.provider}/${d.model.modelId}` : "unknown";
  const status = d.lastAssistantStatus.error
    ? `error: ${d.lastAssistantStatus.error}`
    : d.lastAssistantStatus.stopReason ?? "n/a";

  const lines: string[] = [
    `sessionId: ${d.sessionId}`,
    `sessionName: ${d.sessionName || "(unnamed)"}`,
    `cwd: ${d.cwd || "(unknown)"}`,
    `created: ${d.created ?? "(unknown)"}`,
    `modified: ${d.modified ?? "(unknown)"}`,
    `messageCount: ${d.messageCount}`,
    `model: ${model}`,
    `thinkingLevel: ${d.thinkingLevel}`,
    `state: ${d.alive ? (d.running ? "running" : "loaded (idle)") : "not in memory"}`,
    `totalTokens: input=${d.totalUsage.inputTokens} output=${d.totalUsage.outputTokens} cacheRead=${d.totalUsage.cacheReadTokens} cacheWrite=${d.totalUsage.cacheWriteTokens} cost=${d.totalUsage.cost.toFixed(6)}`,
    `compactionCount: ${d.compaction.count}${d.compaction.lastTokensBefore != null ? ` (lastTokensBefore=${d.compaction.lastTokensBefore})` : ""}`,
    `lastAssistantStatus: ${status}`,
  ];
  if (d.parentSessionId) lines.push(`parentSessionId: ${d.parentSessionId}`);
  lines.push("");
  lines.push(`firstUserMessage:\n${d.firstUserMessage || "(none)"}`);
  lines.push("");
  lines.push(`lastAssistantMessage:\n${d.lastAssistantMessage || "(none)"}`);
  if (d.compaction.lastSummary) {
    lines.push("");
    lines.push(`lastCompactionSummary:\n${d.compaction.lastSummary}`);
  }
  return lines.join("\n");
}

async function getSessionInfo(sessionId: string) {
  const details = await readSessionDetails(sessionId);
  if (!details) {
    const notFound: GetSessionInfoDetails = {
      action: "get_session_info",
      sessionId,
      sessionName: "",
      cwd: "",
      created: null,
      modified: null,
      messageCount: 0,
      model: null,
      thinkingLevel: "off",
      firstUserMessage: "",
      lastAssistantMessage: "",
      lastAssistantStatus: { stopReason: null, error: null },
      totalUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
      compaction: { count: 0, lastTokensBefore: null, lastSummary: null },
      parentSessionId: undefined,
      alive: false,
      running: false,
      error: "not_found",
    };
    return {
      content: [{ type: "text" as const, text: `Error: session not found: ${sessionId}` }],
      details: notFound,
    };
  }
  const payload = sessionInfoPayload(sessionId, details);
  return { content: [{ type: "text" as const, text: sessionInfoText(payload) }], details: payload };
}

// ============================================================================
// Tool registration
// ============================================================================

const PiWorkCallParams = Type.Object(
  {
    action: Type.Union(
      [
        Type.Literal("list_recent_sessions"),
        Type.Literal("list_active_sessions"),
        Type.Literal("get_session_info"),
      ],
      {
        description:
          "Which Pi Work platform operation to perform. 'list_recent_sessions' lists the most recently modified sessions (use `limit`). 'list_active_sessions' lists sessions currently loaded in memory. 'get_session_info' returns a detail snapshot for one session (use `sessionId`).",
      },
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 50,
        default: 10,
        description: "list_recent_sessions only: number of most recently modified sessions to return (1-50, default 10).",
      }),
    ),
    sessionId: Type.Optional(
      Type.String({
        minLength: 1,
        description: "get_session_info only: the Pi Work session id to inspect (e.g. one returned by list_active_sessions or list_recent_sessions).",
      }),
    ),
  },
  { additionalProperties: false },
);

export type PiWorkCallDetails =
  | ListRecentSessionsDetails
  | ListActiveSessionsDetails
  | GetSessionInfoDetails;

export const piWorkCallTool = defineTool<typeof PiWorkCallParams, PiWorkCallDetails>({
  name: PI_WORK_CALL_TOOL,
  label: "Pi Work Call",
  description:
    "Call Pi Work platform capabilities. Actions: 'list_recent_sessions' (most recently modified sessions, newest first, with id/name/first user message; use `limit` 1-50, default 10), 'list_active_sessions' (ids of sessions currently loaded in Pi Work's memory, plus which are running; a session not in memory won't be listed), 'get_session_info' (read-only disk-backed detail snapshot for one session id: sessionName, cwd, created/modified timestamps, messageCount, current model + thinking level, first user message, last assistant message text + stop reason/error, aggregated token usage (input/output/cache + cost), compaction history (count, last tokens-before + summary), parent session, and whether the session is alive/running; returns error not_found when the id doesn't exist). Get a session id first via list_active_sessions or list_recent_sessions, then pass it to get_session_info.",
  parameters: PiWorkCallParams,
  executionMode: "sequential",
  promptSnippet: "Call Pi Work platform APIs: recent/active sessions and session detail.",
  async execute(_toolCallId, params) {
    switch (params.action) {
      case "list_recent_sessions":
        return listRecentSessions(params.limit);
      case "list_active_sessions":
        return listActiveSessions();
      case "get_session_info":
        return getSessionInfo(params.sessionId ?? "");
    }
  },
});
