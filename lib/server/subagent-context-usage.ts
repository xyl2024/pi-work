import { getCurrentSystemMessage, type Usage } from "@earendil-works/pi-ai";
import {
  buildSessionProjection,
  calculateContextTokens,
  estimateTokens,
  getLatestCompactionEntry,
  ModelRuntime,
  SessionManager,
  type SessionEntry,
  type SessionProjection,
} from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/server/session-registry";
import { fallbackSessionLeafId, resolveSessionPath } from "@/lib/server/sessions/reader";
import type { SubagentSessionContextUsage } from "@/lib/shared/types";

type AgentMessage = SessionProjection["messages"][number];

declare global {
  var __piSubagentContextModelRuntime: Promise<ModelRuntime> | undefined;
}

function getModelRuntime(): Promise<ModelRuntime> {
  globalThis.__piSubagentContextModelRuntime ??= ModelRuntime.create();
  return globalThis.__piSubagentContextModelRuntime;
}

async function readContextWindow(provider: string, modelId: string): Promise<number | null> {
  try {
    const runtime = await getModelRuntime();
    const contextWindow = runtime.getModel(provider, modelId)?.contextWindow ?? 0;
    return contextWindow > 0 ? contextWindow : null;
  } catch {
    globalThis.__piSubagentContextModelRuntime = undefined;
    return null;
  }
}

function readAssistantUsage(message: AgentMessage): Usage | undefined {
  if (message.role !== "assistant") return undefined;
  const assistant = message as { stopReason?: string; usage?: Usage };
  if (assistant.stopReason === "aborted" || assistant.stopReason === "error") return undefined;
  if (!assistant.usage) return undefined;
  return calculateContextTokens(assistant.usage) > 0 ? assistant.usage : undefined;
}

function estimateContextTokens(messages: readonly AgentMessage[]): { tokens: number; lastUsageIndex: number | null } {
  let lastUsageIndex: number | null = null;
  let usageTokens = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = readAssistantUsage(messages[index]);
    if (!usage) continue;
    lastUsageIndex = index;
    usageTokens = calculateContextTokens(usage);
    break;
  }
  if (lastUsageIndex === null) {
    let tokens = 0;
    for (const message of messages) tokens += estimateTokens(message);
    return { tokens, lastUsageIndex };
  }
  let trailingTokens = 0;
  for (let index = lastUsageIndex + 1; index < messages.length; index += 1) {
    trailingTokens += estimateTokens(messages[index]);
  }
  return { tokens: usageTokens + trailingTokens, lastUsageIndex };
}

function estimateProjectedTokens(projection: SessionProjection, branchEntries: readonly SessionEntry[]): number {
  const estimate = estimateContextTokens(projection.messages);
  if (estimate.lastUsageIndex !== null) {
    let projectedMessageIndex = 0;
    let usageEntryId: string | null = null;
    for (const entry of projection.entries) {
      const nextMessageIndex = projectedMessageIndex + entry.messages.length;
      if (estimate.lastUsageIndex < nextMessageIndex) {
        usageEntryId = entry.sourceEntry.id;
        break;
      }
      projectedMessageIndex = nextMessageIndex;
    }
    const usageEntryIndex = usageEntryId
      ? branchEntries.findIndex((entry) => entry.id === usageEntryId)
      : -1;
    let latestInvalidatingEntryIndex = -1;
    for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
      const type = branchEntries[index].type;
      if (type === "context_edit" || type === "compaction") {
        latestInvalidatingEntryIndex = index;
        break;
      }
    }
    if (usageEntryIndex > latestInvalidatingEntryIndex) return estimate.tokens;
  }
  const currentSystem = getCurrentSystemMessage(projection.messages);
  let tokens = currentSystem ? estimateTokens(currentSystem) : 0;
  for (const message of projection.messages) {
    if (message.role !== "system") tokens += estimateTokens(message);
  }
  return tokens;
}

function hasUsageAfterLatestCompaction(
  projection: SessionProjection,
  branchEntries: readonly SessionEntry[],
): boolean {
  const latestCompaction = getLatestCompactionEntry(branchEntries as SessionEntry[]);
  if (!latestCompaction) return true;
  const assistantsWithUsage = new Set(
    projection.entries.flatMap((entry) =>
      entry.messages.some((message) => readAssistantUsage(message) !== undefined)
        ? [entry.sourceEntry.id]
        : [],
    ),
  );
  const compactionIndex = branchEntries.findIndex((entry) => entry.id === latestCompaction.id);
  return branchEntries
    .slice(compactionIndex + 1)
    .some((entry) => assistantsWithUsage.has(entry.id));
}

export async function readStoredSessionContextUsage(
  sessionId: string,
): Promise<SubagentSessionContextUsage | null> {
  try {
    const filePath = await resolveSessionPath(sessionId);
    if (!filePath) return null;
    const manager = SessionManager.open(filePath);
    const entries = manager.getEntries() as unknown as SessionEntry[];
    const leafId = fallbackSessionLeafId(manager, manager.getLeafId());
    const projection = buildSessionProjection(entries, leafId);
    const model = projection.model;
    if (!model) return null;
    const contextWindow = await readContextWindow(model.provider, model.modelId);
    if (contextWindow === null) return null;
    const branchEntries = manager.getBranch() as unknown as SessionEntry[];
    if (!hasUsageAfterLatestCompaction(projection, branchEntries)) {
      return { tokens: null, contextWindow, percent: null, stale: true, live: false };
    }
    const tokens = estimateProjectedTokens(projection, branchEntries);
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100, stale: false, live: false };
  } catch {
    return null;
  }
}

export async function readSubagentSessionContextUsage(
  sessionId: string,
): Promise<SubagentSessionContextUsage | null> {
  const live = getRpcSession(sessionId)?.getContextUsage();
  if (live) {
    if (live.contextWindow <= 0) return null;
    if (live.tokens === null) {
      return { tokens: null, contextWindow: live.contextWindow, percent: null, stale: true, live: true };
    }
    const percent = live.percent ?? (live.tokens / live.contextWindow) * 100;
    return { tokens: live.tokens, contextWindow: live.contextWindow, percent, stale: false, live: true };
  }
  return readStoredSessionContextUsage(sessionId);
}
