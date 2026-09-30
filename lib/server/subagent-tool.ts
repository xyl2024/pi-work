import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentSessionWrapper } from "./rpc-manager";
import { runTurn, type TurnAbortSource } from "./turn";
import { toSubagentEnd, type SubagentEndStatus } from "./subagent-run-end";
import { readSessionDetails } from "./session-reader";
import { writeSessionName } from "./session-names";
import { MAX_CONCURRENT_SUBAGENT_RUNS } from "../shared/types";
import { SUBAGENT_NAME_MAX, type SubagentProfile } from "../shared/subagent";
import { getSubagentProfile, listSubagentProfiles } from "./subagent-profiles";
import {
  completeSubagentTask,
  createSubagentTask,
  failSubagentTask,
  getSubagentTask,
  markSubagentRunning,
} from "./subagent-store";

// Re-exported from their new home so existing importers (tests, rpc-manager)
// keep resolving the default tool set through the tool module.
export {
  SUBAGENT_CODEGRAPH_TOOLS,
  SUBAGENT_READ_ONLY_TOOLS,
  subagentTools,
} from "./subagent-tools";

export const SPAWN_SUBAGENT_TOOL_NAME = "spawn_subagent";

const MAX_PROMPT_LENGTH = 50_000;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_RESULT_LENGTH = 20_000;
const SUBAGENT_CUSTOM_ENTRY = "pi_work_subagent";

/**
 * Wording for a subagent run that must not go on: the parent agent aborted the
 * tool call, or the run was refused its slot because the parent stopped while
 * queued. Shared so the abort source and the slot queue cannot drift apart.
 */
const SUBAGENT_CANCELLED = "Subagent cancelled";

/**
 * Admittance bookkeeping for parallel subagent runs: at most
 * MAX_CONCURRENT_SUBAGENT_RUNS child sessions run at once, the rest queue.
 */
interface SubagentSlots {
  /** Number of admitted subagent runs. */
  active: number;
  /** FIFO of queued admissions, each owned by the waiter it admits. */
  waiting: Array<() => void>;
}

declare global {
  var __piSubagentSlots: SubagentSlots | undefined;
}

/** Process-wide slot table; on `globalThis` so dev-mode reloads share it. */
function getSubagentSlots(): SubagentSlots {
  if (!globalThis.__piSubagentSlots) {
    globalThis.__piSubagentSlots = { active: 0, waiting: [] };
  }
  return globalThis.__piSubagentSlots;
}

/**
 * Wait for a free subagent slot and resolve with the function that frees it
 * again. Rejects with `SUBAGENT_CANCELLED` when any given signal aborts while
 * still queued, so a stopped or deleted parent never starts a child it is no
 * longer waiting for.
 */
function acquireSubagentSlot(signals: Array<AbortSignal | undefined>): Promise<() => void> {
  const slots = getSubagentSlots();
  const live = signals.filter((signal): signal is AbortSignal => !!signal);
  if (live.some((signal) => signal.aborted)) {
    return Promise.reject(new Error(SUBAGENT_CANCELLED));
  }
  const release = () => {
    slots.active -= 1;
    slots.waiting.shift()?.();
  };
  if (slots.active < MAX_CONCURRENT_SUBAGENT_RUNS) {
    slots.active += 1;
    return Promise.resolve(release);
  }
  return new Promise((resolve, reject) => {
    function cleanup() {
      for (const signal of live) signal.removeEventListener("abort", cancel);
    }
    function cancel() {
      const index = slots.waiting.indexOf(admit);
      if (index !== -1) slots.waiting.splice(index, 1);
      reject(new Error(SUBAGENT_CANCELLED));
    }
    function admit() {
      cleanup();
      slots.active += 1;
      resolve(release);
    }
    for (const signal of live) signal.addEventListener("abort", cancel, { once: true });
    slots.waiting.push(admit);
    // A signal can abort between the check above and its listener being added
    // (addEventListener never fires for an already-aborted signal).
    if (live.some((signal) => signal.aborted)) cancel();
  });
}

const SpawnSubagentParams = Type.Object({
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
      "Name of the configured subagent profile to run. See the spawn_subagent guidelines in the system prompt for the available names.",
  }),
}, { additionalProperties: false });

interface SpawnSubagentDetails {
  taskId: string;
  sessionId: string | null;
  /** "running" is only ever seen on in-flight onUpdate partials (never persisted). */
  status: "running" | SubagentEndStatus;
  /** Name of the profile that was launched. */
  subagentName: string;
  description: string;
  result?: string;
  error?: string;
}

function resultEnvelope(details: SpawnSubagentDetails) {
  const status = details.status === "completed" ? "completed" : details.status;
  const text = details.status === "completed"
    ? `Subagent completed (${details.sessionId}).\n\n${details.result ?? "(no result)"}`
    : `Subagent ${status} (${details.taskId}).\n\n${details.error ?? "Unknown error"}`;
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const value = message as { role?: unknown; content?: unknown };
  if (value.role !== "assistant") return "";
  if (!Array.isArray(value.content)) return "";
  return value.content
    .filter((block): block is { type?: unknown; text?: unknown } => !!block && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n\n")
    .trim();
}

function truncateResult(text: string): string {
  if (text.length <= MAX_RESULT_LENGTH) return text;
  return `${text.slice(0, MAX_RESULT_LENGTH)}\n… [truncated ${text.length - MAX_RESULT_LENGTH} chars]`;
}

function getLastAssistantText(details: Awaited<ReturnType<typeof readSessionDetails>>): string {
  const messages = details?.context.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = extractMessageText(messages[i]);
    if (text) return truncateResult(text);
  }
  return "";
}

/**
 * Whole-block system-prompt contribution for `spawn_subagent`. Appended at the
 * very end of the system prompt via `appendSystemPromptOverride`, gated on the
 * tool being enabled AND part of the session's tool set. Built per session from
 * the configured profiles so the model always sees the current names and
 * descriptions; with no profiles configured it says so instead of listing
 * names that no longer exist.
 */
export function buildSpawnSubagentSystemPromptBlock(
  profiles: readonly SubagentProfile[] = listSubagentProfiles(),
): string {
  const catalog = profiles.length > 0
    ? profiles.map((profile) => `  - \`${profile.name}\`: ${profile.description}`).join("\n")
    : "  - (no subagents are configured yet; ask the user to create one in Settings → Subagents)";
  return `\
## Tool spawn_subagent guidelines
- For independent tasks that are parallelizable and have a well-defined scope, dispatch the tasks to subagents using \`spawn_subagent\`. Examples include codebase exploration, research and information gathering, and code review.
- \`subagent_name\` selects one of the configured subagents:
${catalog}
- Each subagent has its own system prompt, tool set, model and runtime limit; pick the one whose description best matches the task.
- When you need to explore the codebase, prioritize dispatching a read-only explorer subagent over exploring it yourself, and give it a purely exploration-and-reporting task without requiring suggestions.
- When you hand a subagent a change, files, or a question to review, also state the standards to judge against.
- Independent tasks can be dispatched together: emit several \`spawn_subagent\` calls in the same message instead of one per turn. Subagents run in parallel (at most ${MAX_CONCURRENT_SUBAGENT_RUNS} at a time, further calls wait for a free slot), so keep each task self-contained and do not make one depend on another's result.
`;
}

export const spawnSubagentTool = defineTool<typeof SpawnSubagentParams, SpawnSubagentDetails>({
  name: SPAWN_SUBAGENT_TOOL_NAME,
  label: "Spawn Subagent",
  description: "Launch a persistent specialized subagent to handle a focused task. Pick the subagent by name from the configured profiles listed in the spawn_subagent guidelines. The subagent runs in the current working directory and returns an evidence-based conclusion.",
  parameters: SpawnSubagentParams,
  // No `executionMode`: the SDK default ("parallel") is what lets one assistant
  // message dispatch several subagents at once. Declaring "sequential" would
  // demote the whole tool batch to serial and start them one after another.
  promptSnippet: "Launch a specialized subagent for a focused task.",
  // Guidelines moved to `buildSpawnSubagentSystemPromptBlock` — injected via
  // appendSystemPromptOverride, gated on the tool being loaded.
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const description = params.description.trim();
    const prompt = params.prompt.trim();
    const requestedName = params.subagent_name.trim();
    const profile = getSubagentProfile(requestedName);
    if (!profile) {
      // Report the miss to the model (so it can retry with a listed name)
      // instead of throwing or writing a task row for a run that never starts.
      const available = listSubagentProfiles().map((candidate) => candidate.name);
      return {
        content: [{
          type: "text" as const,
          text: `Unknown subagent_name "${requestedName}". Available subagents: ${
            available.length > 0 ? available.join(", ") : "(none configured)"
          }.`,
        }],
        details: { taskId: "", sessionId: null, status: "failed", subagentName: requestedName, description },
        isError: true,
      };
    }
    const taskId = `subagent:${randomUUID()}`;
    const parentSessionId = ctx.sessionManager.getSessionId();

    const task = createSubagentTask({
      taskId,
      parentSessionId,
      subagentName: profile.name,
      description,
      prompt,
    });

    // Side condition that must stop the child together with its trigger: the
    // parent wrapper was destroyed (session deleted, idle reap, process-exit
    // cleanup). The child's own two stop conditions — the child session being
    // closed and the parent agent aborting this tool call — are wired below,
    // once the child session exists / the tool's AbortSignal is known.
    const parentStop = new AbortController();
    const childGone = new AbortController();
    // Caller-side wiring of the child run, filled in by the factory below and
    // read back here: the child session (needed to write its discovery entry
    // once the run completed) and its destroy subscription (dropped in the
    // cleanup). They live in a holder because the only assignments happen
    // inside the factory closure, where a plain local would defeat the type
    // checker.
    const childRun: { session: AgentSessionWrapper | null; offDestroy: (() => void) | null } = {
      session: null,
      offDestroy: null,
    };
    let offParentDestroy: (() => void) | null = null;
    let releaseSlot: (() => void) | null = null;

    try {
      const { getRpcSession, startRpcSession } = await import("./rpc-manager");
      const parent = getRpcSession(parentSessionId);
      if (parent && !parent.isAlive()) {
        throw new Error("Parent session has already stopped");
      }
      const parentModel = parent?.inner.model;
      if (!parentModel) {
        throw new Error("The main agent has no active model to inherit");
      }
      // Stop the child whenever the parent wrapper is destroyed.
      offParentDestroy = parent?.onDestroy(() => parentStop.abort());

      // Wait for a free parallel slot before creating the child session. The
      // stop sources are honoured while queued so a cancelled or stopped
      // parent does not leave a child starting up for nothing.
      releaseSlot = await acquireSubagentSlot([signal, parentStop.signal]);

      // The profile's tools verbatim. The seeded profiles carry the read-only
      // core plus this machine's shells; a user-created profile carries
      // whatever the editor picked (docs/adr/0001 no longer constrains it — a
      // profile that includes a confirmation-gated tool simply fails on that
      // call, since a child has no prompt UI).
      const tools = [...profile.tools];
      const displayName = `[Subagent] ${description}`;
      const registryKey = `__subagent__${taskId}`;

      // The run itself goes through the turn module: session acquisition (the
      // factory below), the terminal wait, the stop policy and the cleanup.
      // The child's stop conditions are the caller's to name, and are handed
      // over as abort sources — any one firing tells the child to abort and
      // settles the run as `cancelled` at once.
      const abortSources: TurnAbortSource[] = [
        {
          signal: parentStop.signal,
          reason: "Subagent stopped because the parent session was stopped",
        },
        {
          signal: childGone.signal,
          reason: "Subagent stopped because the subagent session was closed",
        },
      ];
      if (signal) {
        abortSources.push({ signal, reason: SUBAGENT_CANCELLED });
      }

      const turn = await runTurn(
        {
          cwd: ctx.cwd,
          prompt,
          toolNames: tools,
          source: "subagent",
          timeoutMs: profile.timeoutMs,
          abortSources,
          // Runs the moment the child session is acquired — before the prompt.
          // Publishes the taskId/child-sessionId to the parent session's event
          // stream (tool_execution_update → in-flight tool result details) so
          // the UI's spawn_subagent ToolCallBlock can start polling child
          // activity before the tool itself finishes.
          onSession: ({ realSessionId }) => {
            markSubagentRunning(taskId, realSessionId);
            onUpdate?.({
              // Content stays empty — the parent UI renders its own live panel
              // while details.status === "running", and any text here would be
              // mistaken for the final result.
              content: [],
              details: { taskId, sessionId: realSessionId, status: "running" as const, subagentName: profile.name, description },
            });
          },
        },
        // Session acquisition for a subagent turn: always a fresh child session
        // under its own registry key, with the profile's tool set and system
        // prompt baked in at creation, and a name so the session is
        // discoverable from the UI.
        async (cwd, toolNames) => {
          const { session, realSessionId } = await startRpcSession(
            registryKey,
            "",
            cwd,
            toolNames,
            "subagent",
            {
              model: profile.model ?? {
                provider: parentModel.provider,
                modelId: parentModel.id,
              },
              thinkingLevel: profile.thinkingLevel,
              allowedToolNames: tools,
              systemPromptPrefix: `${profile.systemPrompt}\n\nYour current working directory is ${cwd}`,
              stripDefaultSystemPromptSections: true,
              parentSessionId,
            },
          );
          childRun.session = session;
          // Stop the run (and abort the child) if the child wrapper is
          // destroyed externally while the tool is still waiting on it.
          childRun.offDestroy = session.onDestroy(() => childGone.abort());
          session.inner.sessionManager.appendSessionInfo(displayName);
          writeSessionName(realSessionId, displayName);
          return { session, sessionId: registryKey, realSessionId };
        },
      );

      const end = toSubagentEnd(turn, profile.timeoutMs);
      // The child's final text is re-read from its session file, exactly as the
      // pre-seam tool did: the tool reports the last assistant message that
      // actually has text, and an abnormal stop attaches it as the partial
      // output. A cancel / interruption / timeout has no partial result to
      // report, so nothing is read for those.
      const resultText = end.status === "completed" || end.partialOutput
        ? getLastAssistantText(await readSessionDetails(turn.realSessionId))
        : "";

      if (end.status === "completed") {
        completeSubagentTask(taskId, resultText);

        // Persist a small non-context entry in the child session so its purpose
        // remains discoverable even when opened independently.
        childRun.session?.inner.sessionManager.appendCustomEntry(SUBAGENT_CUSTOM_ENTRY, {
          taskId,
          parentSessionId,
          description,
          subagentName: profile.name,
        });

        return resultEnvelope({
          taskId,
          sessionId: turn.realSessionId,
          status: "completed",
          subagentName: profile.name,
          description,
          result: resultText,
        });
      }

      const reason = end.error ?? "Unknown error";
      // The store records the bare reason; the tool result also carries the
      // partial output, exactly as before.
      failSubagentTask(taskId, reason, end.status);
      return resultEnvelope({
        taskId,
        sessionId: turn.realSessionId,
        status: end.status,
        subagentName: profile.name,
        description,
        error: resultText ? `${reason}\n\nLast partial output:\n${resultText}` : reason,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Everything that reaches here failed before a turn existed: the slot
      // queue refusing a parent that stopped, a parent that was already gone,
      // no model to inherit, a child session that could not be created. The
      // only cancel wording among them is the queue's (a turn stopped by one of
      // the abort sources settles as `cancelled` instead, via `toSubagentEnd`).
      const cancelled = message === SUBAGENT_CANCELLED;
      failSubagentTask(task.taskId, message, cancelled ? "cancelled" : "failed");
      return resultEnvelope({
        taskId,
        sessionId: getSubagentTaskSessionId(task.taskId),
        status: cancelled ? "cancelled" : "failed",
        subagentName: profile.name,
        description,
        error: message,
      });
    } finally {
      releaseSlot?.();
      offParentDestroy?.();
      childRun.offDestroy?.();
    }
  },
});

// Kept local to avoid exposing the persistence implementation through the tool
// result type. A failed start can still have produced a persistent child id.
function getSubagentTaskSessionId(taskId: string): string | null {
  return getSubagentTask(taskId)?.childSessionId ?? null;
}
