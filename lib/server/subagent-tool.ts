/**
 * The `subagent` agent tool.
 *
 * One tool, action-discriminated parameters. This issue ships `spawn`: it
 * resolves a profile, freezes the child configuration, hands the task to the
 * task manager and then *waits* (15 minutes by default, 0 for an immediate
 * return) for an answer. The wait is only an observation — when it expires the
 * task keeps running under the manager, its result stays collectable, and the
 * parent turn can finish normally.
 *
 * The previous `spawn_subagent` name is deliberately not registered: stored
 * tool selections are migrated on load (`lib/server/session-tools-config.ts`,
 * `lib/server/cwd-tools-config.ts`) and old messages stay readable because the
 * display layer recognises both names.
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SUBAGENT_WAIT_MS,
  MAX_SUBAGENT_WAIT_MS,
  SUBAGENT_NAME_MAX,
  SUBAGENT_TOOL_NAME,
  type SubagentProfile,
} from "../shared/subagent";
import { MAX_CONCURRENT_SUBAGENT_RUNS, type SubagentTaskStatus } from "../shared/types";
import {
  getSubagentTaskManager,
  resolveSubagentTaskConfig,
  SUBAGENT_CANCELLED,
  type SubagentTaskProgress,
  type SubagentTaskWaitResult,
} from "./subagent-tasks";
import { getSubagentProfile, listSubagentProfiles } from "./subagent-profiles";

// Re-exported from its new home so existing importers (tests, rpc-manager) keep
// resolving the default tool set through the tool module.
export { subagentTools } from "./subagent-tools";
// Re-exported for the tests that have always imported the prompt rule from the
// tool module; the rule itself lives with the task config it feeds.
export { resolveSubagentSystemPrompt } from "./subagent-tasks";
export { SUBAGENT_TOOL_NAME };

const MAX_PROMPT_LENGTH = 50_000;

/** The parent facts a spawn needs, resolved from the live registry. */
export interface SubagentParentContext {
  parentSessionId: string;
  model: { provider: string; modelId: string };
  /** The parent's rendered system prompt, for profiles that inherit it. */
  systemPrompt: string | null;
}

/** How the tool learns its parent. Tests substitute this seam. */
export type SubagentParentResolver = (parentSessionId: string) => Promise<SubagentParentContext>;

declare global {
  var __piSubagentParentResolver: SubagentParentResolver | undefined;
}

const liveParentResolver: SubagentParentResolver = async (parentSessionId) => {
  const { getRpcSession } = await import("./rpc-manager");
  const parent = getRpcSession(parentSessionId);
  if (!parent) throw new Error("Parent session is not running");
  if (!parent.isAlive()) throw new Error("Parent session has already stopped");
  const model = parent.inner.model;
  if (!model) throw new Error("The main agent has no active model to inherit");
  return {
    parentSessionId,
    model: { provider: model.provider, modelId: model.id },
    systemPrompt: parent.inner.systemPrompt,
  };
};

function resolveParent(): SubagentParentResolver {
  return globalThis.__piSubagentParentResolver ?? liveParentResolver;
}

/** Test seam: replace / clear the parent resolver. */
export function setSubagentParentResolverForTests(resolver: SubagentParentResolver | null): void {
  globalThis.__piSubagentParentResolver = resolver ?? undefined;
}
const MAX_DESCRIPTION_LENGTH = 200;

export const SpawnParams = Type.Object({
  action: Type.Literal("spawn", { description: "Create and run a new subagent task." }),
  description: Type.String({
    minLength: 1,
    maxLength: MAX_DESCRIPTION_LENGTH,
    description: "A short 3-5 word description of the task",
  }),
  prompt: Type.String({
    minLength: 1,
    maxLength: MAX_PROMPT_LENGTH,
    description: "The complete instructions for the subagent",
  }),
  subagent_name: Type.String({
    minLength: 1,
    maxLength: SUBAGENT_NAME_MAX,
    description:
      "Name of the configured subagent profile to run. See the subagent guidelines in the system prompt for the available names.",
  }),
  wait_ms: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: MAX_SUBAGENT_WAIT_MS,
    description:
      `How long to wait for the result. Defaults to ${DEFAULT_SUBAGENT_WAIT_MS} ms; 0 returns immediately.`
      + " When the wait expires the task keeps running and can be observed again later.",
  })),
}, { additionalProperties: false });

// One action today (`spawn`); later actions join this object as a union. The
// literal discriminator is what keeps per-action parameter validation honest.
export const SubagentParams = SpawnParams;

/** Details carried on the tool result and on every in-flight progress update. */
export interface SubagentToolDetails {
  action: "spawn";
  taskId: string;
  childSessionId: string | null;
  /** Non-terminal while the caller only observed a part of the task's life. */
  status: SubagentTaskStatus;
  subagentName: string;
  description: string;
  /** True when the caller's wait ran out and the task is still unfinished. */
  waitExpired: boolean;
  /** Completed result, or the last partial output of an abnormal stop. */
  result?: string;
  error?: string;
}

function progressDetails(
  progress: SubagentTaskProgress,
): SubagentToolDetails {
  return {
    action: "spawn",
    taskId: progress.taskId,
    childSessionId: progress.childSessionId,
    status: progress.status,
    subagentName: progress.subagentName,
    description: progress.description,
    waitExpired: false,
  };
}

function targetOf(task: Pick<SubagentTaskWaitResult, "taskId" | "childSessionId">): string {
  return task.childSessionId
    ? `task ${task.taskId}, session ${task.childSessionId}`
    : `task ${task.taskId}`;
}

/**
 * The model-facing text. Deliberately explicit about which of the two limits
 * expired (wait vs. runtime) and about the task still being alive, so the
 * parent never mistakes a wait timeout for a failed task.
 */
function waitResultEnvelope(task: SubagentTaskWaitResult, waitMs: number) {
  const details: SubagentToolDetails = {
    action: "spawn",
    taskId: task.taskId,
    childSessionId: task.childSessionId,
    status: task.status,
    subagentName: task.subagentName,
    description: task.description,
    waitExpired: task.waitExpired,
    ...(task.result ? { result: task.result } : {}),
    ...(task.error ? { error: task.error } : {}),
  };

  let text: string;
  if (task.status === "completed") {
    text = `Subagent completed (${targetOf(task)}).\n\n${task.result || "(no result)"}`;
  } else if (task.waitExpired && !isTerminalStatus(task.status)) {
    const waited = waitMs >= 1000 ? `${Math.round(waitMs / 1000)}s` : `${waitMs}ms`;
    text = `Subagent is still ${task.status} after ${waited} (${targetOf(task)}).`
      + " The task keeps running in the background; it was not cancelled and its runtime limit is unaffected.";
  } else if (isTerminalStatus(task.status)) {
    const partial = task.result ? `\n\nLast partial output:\n${task.result}` : "";
    text = `Subagent ${task.status} (${targetOf(task)}).\n\n${task.error ?? "Unknown error"}${partial}`;
  } else {
    // Stopping (a stop was requested but not yet confirmed) is not terminal and
    // not a wait expiry: report the honest state.
    text = `Subagent is ${task.status} (${targetOf(task)}).`
      + " The stop was requested but has not been confirmed by the session yet.";
  }

  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function isTerminalStatus(status: SubagentTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}

function errorEnvelope(input: {
  subagentName: string;
  description: string;
  error: string;
  taskId?: string;
  childSessionId?: string | null;
}): { content: Array<{ type: "text"; text: string }>; details: SubagentToolDetails; isError: true } {
  const taskId = input.taskId ?? "";
  return {
    content: [{ type: "text" as const, text: input.error }],
    details: {
      action: "spawn",
      taskId,
      childSessionId: input.childSessionId ?? null,
      status: "failed",
      subagentName: input.subagentName,
      description: input.description,
      waitExpired: false,
      error: input.error,
    },
    isError: true,
  };
}

/**
 * Whole-block system-prompt contribution for `subagent`. Appended at the very
 * end of the system prompt via `appendSystemPromptOverride`, gated on the tool
 * being enabled AND part of the session's tool set. Built per session from the
 * configured profiles so the model always sees the current names and
 * descriptions; with no profiles configured it says so instead of listing
 * names that no longer exist.
 */
export function buildSubagentSystemPromptBlock(
  profiles: readonly SubagentProfile[] = listSubagentProfiles(),
): string {
  const catalog = profiles.length > 0
    ? profiles.map((profile) => `  - \`${profile.name}\`: ${profile.description}`).join("\n")
    : "  - (no subagents are configured yet; ask the user to create one in Settings → Subagents)";
  return `\
## Tool subagent guidelines
- For independent tasks that are parallelizable and have a well-defined scope, dispatch the tasks to subagents with \`subagent\` and \`action: "spawn"\`. Examples include codebase exploration, research and information gathering, and code review.
- \`subagent_name\` selects one of the configured subagents:
${catalog}
- Each subagent has its own system prompt, tool set, model and runtime limit; pick the one whose description best matches the task.
- \`spawn\` waits 15 minutes by default and returns the result. Pass a smaller \`wait_ms\` (0 for none) to keep working in parallel: the task keeps running in the background after the wait expires, and its status is not a failure.
- When you need to explore the codebase, prioritize dispatching a read-only explorer subagent over exploring it yourself, and give it a purely exploration-and-reporting task without requiring suggestions.
- When you hand a subagent a change, files, or a question to review, also state the standards to judge against.
- Independent tasks can be dispatched together: emit several \`subagent\` calls in the same message instead of one per turn. Subagents run in parallel (at most ${MAX_CONCURRENT_SUBAGENT_RUNS} at a time, further tasks queue in order), so keep each task self-contained and do not make one depend on another's result.
`;
}

export const subagentTool = defineTool<typeof SubagentParams, SubagentToolDetails>({
  name: SUBAGENT_TOOL_NAME,
  label: "Subagent",
  description: "Manage subagent tasks. action=\"spawn\" launches a persistent specialized subagent for a focused task and returns its result (waiting up to 15 minutes by default). Pick the subagent by name from the configured profiles listed in the subagent guidelines; the subagent runs in the current working directory and returns an evidence-based conclusion. With wait_ms=0 the call returns at once and the task keeps running in the background.",
  parameters: SubagentParams,
  // No `executionMode`: the SDK default ("parallel") is what lets one assistant
  // message dispatch several subagents at once. Declaring "sequential" would
  // demote the whole tool batch to serial and start them one after another.
  promptSnippet: "Launch a specialized subagent for a focused task.",
  // Guidelines moved to `buildSubagentSystemPromptBlock` — injected via
  // appendSystemPromptOverride, gated on the tool being loaded.
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const description = params.description.trim();
    const prompt = params.prompt.trim();
    const requestedName = params.subagent_name.trim();
    const waitMs = params.wait_ms ?? DEFAULT_SUBAGENT_WAIT_MS;

    const profile = getSubagentProfile(requestedName);
    if (!profile) {
      // Report the miss to the model (so it can retry with a listed name)
      // instead of throwing or writing a task row for a run that never starts.
      const available = listSubagentProfiles().map((candidate) => candidate.name);
      return errorEnvelope({
        subagentName: requestedName,
        description,
        error: `Unknown subagent_name "${requestedName}". Available subagents: ${
          available.length > 0 ? available.join(", ") : "(none configured)"
        }.`,
      });
    }

    try {
      // The parent comes from the call context, never from the tool's
      // arguments, so a child can only ever see its own direct subagents.
      const parent = await resolveParent()(ctx.sessionManager.getSessionId());

      const config = resolveSubagentTaskConfig({
        profile,
        cwd: ctx.cwd,
        parentModel: parent.model,
        // Resolved before the child starts so a missing parent prompt fails the
        // spawn instead of silently choosing a different prompt.
        parentSystemPrompt: profile.inheritSystemPrompt ? parent.systemPrompt : null,
      });

      const manager = getSubagentTaskManager();
      const task = manager.spawn({
        parentSessionId: parent.parentSessionId,
        description,
        prompt,
        config,
        onProgress: (progress) => {
          // In-flight partials let the parent UI start rendering the child's
          // live panel (and its queued state) before the call returns. Content
          // stays empty: the block draws its own panel while the task is not
          // terminal, and any text would be mistaken for the final result.
          onUpdate?.({ content: [], details: progressDetails(progress) });
        },
      });

      const result = await manager.wait(task.taskId, {
        timeoutMs: waitMs,
        // The tool call's own abort (the user stopped the parent turn) is a
        // stop for this task; the turn module confirms it before the row turns
        // terminal, so the wait reports "stopping" rather than pretending.
        ...(signal ? { stopOnAbort: { signal, reason: SUBAGENT_CANCELLED } } : {}),
      });

      return waitResultEnvelope(result, waitMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorEnvelope({ subagentName: profile.name, description, error: message });
    }
  },
});
