/**
 * Child-session configuration across a cold start.
 *
 * A child session's creation-time settings live in the task row that created it
 * (`config_snapshot`), never in today's profile: editing or deleting a profile
 * must not reconfigure a child that already exists. This module is the one
 * place that turns a snapshot back into `StartRpcSessionOptions`, and the one
 * place that decides what to do for a legacy child that predates snapshots.
 *
 * Legacy recovery is deliberately narrow. Only facts the persisted session can
 * prove are reused — the tool selection mirrored to the session-tools sidecar,
 * the model and thinking level recorded in the session file, and the working
 * directory in its header. Everything else (the original prompt, runtime limit)
 * is replaced by a conservative default, and when the restricted tool set or
 * the model cannot be recovered the child is refused with an explicit error
 * instead of being reopened with today's (possibly wider) defaults.
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  LEGACY_SPAWN_SUBAGENT_TOOL_NAME,
  SUBAGENT_THINKING_LEVELS,
  SUBAGENT_TOOL_NAME,
  type SubagentTaskConfigSnapshot,
  type SubagentThinkingLevel,
} from "../shared/subagent";
import type { StartRpcSessionOptions } from "./rpc-manager";
import { readSessionToolSelection } from "./session-tools-config";
import { getSubagentSessionConfigSnapshot } from "./subagent-store";
import { resolveSessionPath } from "./sessions/reader";

/**
 * Neutral instruction used when a legacy child's original prompt was never
 * recorded. It keeps the child in its old role (a continued subagent) without
 * granting anything; the tool set and model still come from persisted facts.
 */
export const LEGACY_SUBAGENT_SYSTEM_PROMPT =
  "You are continuing a subagent session started earlier. Its original creation-time instructions are not available;"
  + " follow the current task input and stay within your assigned tool set.";

/** A child session that cannot be reopened or continued without widening it. */
export class SubagentConfigRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubagentConfigRestoreError";
  }
}

export interface RestoredSubagentConfig {
  config: SubagentTaskConfigSnapshot;
  /** `snapshot`: the exact creation-time config. `recovered`: best-effort legacy. */
  source: "snapshot" | "recovered";
  /** What could not be restored verbatim (empty for a full snapshot). */
  notes: string[];
}

/**
 * The tool set a child may ever run with: the subagent tool is removed whatever
 * the stored config says, so a renamed or stale entry can never re-enable
 * recursive delegation.
 */
export function restrictSubagentTools(tools: readonly string[]): string[] {
  return tools.filter(
    (tool) => tool !== SUBAGENT_TOOL_NAME && tool !== LEGACY_SPAWN_SUBAGENT_TOOL_NAME,
  );
}

function isThinkingLevel(value: unknown): value is SubagentThinkingLevel {
  return typeof value === "string"
    && (SUBAGENT_THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * Parse a stored snapshot, returning null when it is absent or not usable.
 * Unusable snapshots are treated as legacy rows: recovery only uses facts the
 * child session itself records, so a corrupt blob cannot widen anything either.
 */
export function parseSubagentConfigSnapshot(
  json: string | null | undefined,
): SubagentTaskConfigSnapshot | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const model = raw.model as { provider?: unknown; modelId?: unknown } | null | undefined;
  const prompt = raw.systemPrompt as { kind?: unknown; text?: unknown } | null | undefined;
  if (
    typeof raw.subagentName !== "string" || raw.subagentName.length === 0
    || typeof raw.cwd !== "string" || raw.cwd.length === 0
    || !model || typeof model.provider !== "string" || typeof model.modelId !== "string"
    || !isThinkingLevel(raw.thinkingLevel)
    || !Array.isArray(raw.tools) || !raw.tools.every((tool) => typeof tool === "string")
    || !prompt || (prompt.kind !== "override" && prompt.kind !== "prefix")
    || typeof prompt.text !== "string"
    || typeof raw.timeoutMs !== "number" || !Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0
  ) {
    return null;
  }
  return {
    subagentName: raw.subagentName,
    cwd: raw.cwd,
    model: { provider: model.provider, modelId: model.modelId },
    thinkingLevel: raw.thinkingLevel,
    tools: restrictSubagentTools(raw.tools as string[]),
    systemPrompt: { kind: prompt.kind, text: prompt.text },
    timeoutMs: raw.timeoutMs,
  };
}

/**
 * The tool selection of a legacy child session, or an explicit refusal.
 *
 * The selection is the capability boundary: without it the child would have to
 * fall back to today's cwd default or "all", which is exactly the silent
 * widening this rule exists to prevent. Synchronous, so `continue` can refuse a
 * hopeless recovery before it creates a task row.
 */
export function legacySubagentToolsOrThrow(childSessionId: string): string[] {
  const selection = readSessionToolSelection(childSessionId);
  if (selection === null) {
    throw new SubagentConfigRestoreError(
      `The subagent session "${childSessionId}" has no configuration snapshot and no recorded tool selection,`
      + " so the restricted tool set it was created with cannot be recovered."
      + " Refusing to reopen it with today's defaults; start a new task instead.",
    );
  }
  if (selection === "all") {
    throw new SubagentConfigRestoreError(
      `The subagent session "${childSessionId}" has no configuration snapshot and ran with every tool,`
      + " so it cannot be restored as a restricted subagent. Start a new task instead.",
    );
  }
  return restrictSubagentTools(selection);
}

async function recoverLegacyConfig(input: {
  childSessionId: string;
  subagentName: string;
}): Promise<RestoredSubagentConfig> {
  // Capability boundary first: it needs no file system scan.
  const tools = legacySubagentToolsOrThrow(input.childSessionId);

  const sessionFile = await resolveSessionPath(input.childSessionId);
  if (!sessionFile) {
    throw new SubagentConfigRestoreError(
      `The subagent session "${input.childSessionId}" has no configuration snapshot and its session file is gone,`
      + " so its creation-time settings cannot be restored. Start a new task instead.",
    );
  }

  const sessionManager = SessionManager.open(sessionFile);
  const header = sessionManager.getHeader();
  const context = sessionManager.buildSessionContext();
  if (!context.model) {
    throw new SubagentConfigRestoreError(
      `The subagent session "${input.childSessionId}" has no configuration snapshot and no recorded model,`
      + " so it cannot be continued without guessing which model to use. Start a new task instead.",
    );
  }

  const cwd = header?.cwd?.trim();
  if (!cwd) {
    throw new SubagentConfigRestoreError(
      `The subagent session "${input.childSessionId}" has no configuration snapshot and its session header records`
      + " no working directory, so it cannot be continued in the project it was created for. Start a new task instead.",
    );
  }

  const notes: string[] = [
    "This child session predates configuration snapshots: its tool set, model and working directory were recovered"
    + " from the persisted session; its original system prompt and runtime limit were not recoverable.",
  ];
  if (!isThinkingLevel(context.thinkingLevel)) {
    notes.push(`The recorded thinking level was not recognised; "off" is used.`);
  }

  return {
    config: {
      subagentName: input.subagentName,
      cwd,
      model: context.model,
      thinkingLevel: isThinkingLevel(context.thinkingLevel) ? context.thinkingLevel : "off",
      tools,
      systemPrompt: { kind: "prefix", text: LEGACY_SUBAGENT_SYSTEM_PROMPT },
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
    },
    source: "recovered",
    notes,
  };
}

/**
 * Resolve the configuration a child session must run with: its creation-time
 * snapshot, or — for a legacy child — only the restricted facts its own
 * persisted files prove. Throws `SubagentConfigRestoreError` when even those
 * are unavailable.
 */
export async function resolveSubagentChildConfig(input: {
  parentSessionId: string;
  childSessionId: string;
  /** Recorded subagent name of the session (its task rows carry it). */
  subagentName: string;
}): Promise<RestoredSubagentConfig> {
  const snapshot = parseSubagentConfigSnapshot(
    getSubagentSessionConfigSnapshot(input.parentSessionId, input.childSessionId),
  );
  if (snapshot) return { config: snapshot, source: "snapshot", notes: [] };
  return recoverLegacyConfig({
    childSessionId: input.childSessionId,
    subagentName: input.subagentName,
  });
}

/** Same as `resolveSubagentChildConfig`, but null instead of an error. */
export async function tryResolveSubagentChildConfig(input: {
  parentSessionId: string;
  childSessionId: string;
  subagentName: string;
}): Promise<RestoredSubagentConfig | null> {
  try {
    return await resolveSubagentChildConfig(input);
  } catch (error) {
    if (error instanceof SubagentConfigRestoreError) return null;
    throw error;
  }
}

/**
 * How a child session is started: the frozen snapshot supplies model, thinking
 * level, tool set and system prompt, so neither a continued turn nor a cold
 * start can be reconfigured by editing the profile or by the session's own cwd
 * defaults. The subagent tool is stripped again here for every caller.
 */
export function subagentChildSessionStartOptions(
  config: SubagentTaskConfigSnapshot,
  parentSessionId: string,
): StartRpcSessionOptions {
  const tools = restrictSubagentTools(config.tools);
  return {
    model: config.model,
    thinkingLevel: config.thinkingLevel,
    allowedToolNames: tools,
    ...(config.systemPrompt.kind === "override"
      ? { systemPromptOverride: config.systemPrompt.text }
      : { systemPromptPrefix: config.systemPrompt.text }),
    stripDefaultSystemPromptSections: true,
    parentSessionId,
  };
}
