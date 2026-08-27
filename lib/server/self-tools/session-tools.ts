/**
 * Pi Work self-management tools (read-only).
 *
 * Give the agent visibility into Pi Work itself:
 * - `pi_work_get_active_sessions_id`      — ids of the sessions currently
 *   loaded in memory (the `__piSessions` registry).
 * - `pi_work_get_session_info_by_id`      — disk-backed detail for a session
 *   (name, cwd, timestamps, first/last messages, model, thinking level, token
 *   usage, compaction history).
 *
 * Everything is derived from existing server modules:
 *   - live set + running state: lib/server/session-registry.ts
 *   - disk session detail:      lib/server/session-reader.ts (readSessionDetails)
 *
 * These tools are intentionally READ-ONLY, mirroring the `user_todos_*`
 * philosophy: the agent can inspect Pi Work sessions but never mutate them.
 * They are gated via ~/.pi-work/tools-market.json and only exist inside
 * pi-work sessions (registered in rpc-manager.ts). Because they read server
 * state, they are server-only and must not be imported by client code.
 */

import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { readSessionDetails } from "@/lib/server/session-reader";
import { getRpcSession, listRunningRpcSessions } from "@/lib/server/session-registry";
import type { AgentMessage, AssistantMessage, SessionContext } from "@/lib/shared/types";

export const PI_WORK_ACTIVE_SESSIONS_TOOL = "pi_work_get_active_sessions_id";
export const PI_WORK_SESSION_INFO_TOOL = "pi_work_get_session_info_by_id";

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
// Tool 1: pi_work_get_active_sessions_id
// ============================================================================

const ActiveSessionsParams = Type.Object({}, { additionalProperties: false });

interface ActiveSessionsDetails {
  sessionIds: string[];
  running: string[];
  count: number;
}

function activeSessionsResult() {
  const entries = listRunningRpcSessions();
  const sessionIds = entries.map((e) => e.id);
  const running = entries.filter((e) => e.running).map((e) => e.id);
  const count = sessionIds.length;

  const lines = entries.map((e) => `- ${e.id}${e.running ? " (running)" : ""}`);
  const text =
    count === 0
      ? "No sessions are currently loaded in memory."
      : `Active sessions in memory (${count})${running.length ? `, ${running.length} running` : ""}:\n${lines.join("\n")}`;

  return { content: [{ type: "text" as const, text }], details: { sessionIds, running, count } };
}

// ============================================================================
// Tool 2: pi_work_get_session_info_by_id
// ============================================================================

const SessionInfoParams = Type.Object(
  {
    sessionId: Type.String({
      minLength: 1,
      description: "The Pi Work session id to inspect (e.g. one returned by pi_work_get_active_sessions_id).",
    }),
  },
  { additionalProperties: false },
);

interface CompactionInfo {
  count: number;
  lastTokensBefore: number | null;
  lastSummary: string | null;
}

interface SessionInfoDetails {
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
): SessionInfoDetails {
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

function sessionInfoText(d: SessionInfoDetails): string {
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

async function sessionInfoResult(sessionId: string) {
  const details = await readSessionDetails(sessionId);
  if (!details) {
    const notFound: SessionInfoDetails = {
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

export const activeSessionsTool = defineTool<typeof ActiveSessionsParams, ActiveSessionsDetails>({
  name: PI_WORK_ACTIVE_SESSIONS_TOOL,
  label: "Pi Work Active Sessions",
  description:
    "List the ids of sessions currently loaded in memory in Pi Work (the live session registry). Each entry is a session id you can pass to pi_work_get_session_info_by_id. Sessions that were opened/active recently but not currently in memory are not listed; call pi_work_get_active_sessions_id again after a session loads to refresh.",
  parameters: ActiveSessionsParams,
  executionMode: "sequential",
  promptSnippet: "List active Pi Work session ids.",
  promptGuidelines: [
    "Call pi_work_get_active_sessions_id to enumerate sessions currently loaded in Pi Work, then use pi_work_get_session_info_by_id with a returned session id for detail.",
    "The result is a snapshot; a session that isn't in memory won't be listed.",
  ],
  async execute() {
    return activeSessionsResult();
  },
});

export const sessionInfoTool = defineTool<typeof SessionInfoParams, SessionInfoDetails>({
  name: PI_WORK_SESSION_INFO_TOOL,
  label: "Pi Work Session Info",
  description:
    "Return a read-only disk-backed detail snapshot for one Pi Work session by id (e.g. from pi_work_get_active_sessions_id): sessionName, cwd, created/modified timestamps, messageCount, current model + thinking level, first user message, last assistant message text + stop reason/error, aggregated token usage across all assistant messages (input/output/cache + cost), compaction history (count, last tokens-before + summary), parent session, and whether the session is currently alive/running. Returns an error result if the session id doesn't exist.",
  parameters: SessionInfoParams,
  executionMode: "sequential",
  promptSnippet: "Read details for one Pi Work session.",
  promptGuidelines: [
    "Get an id first with pi_work_get_active_sessions_id.",
    "This tool is read-only; it never modifies the session.",
    "Token usage is aggregated per-message from the disk JSONL; context window is not reported because it is not stored on disk.",
  ],
  async execute(_toolCallId, params) {
    return sessionInfoResult(params.sessionId);
  },
});

export function buildSessionInfoTools() {
  return [activeSessionsTool, sessionInfoTool];
}