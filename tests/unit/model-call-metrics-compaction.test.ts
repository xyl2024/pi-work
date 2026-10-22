import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
  SessionManager,
  SettingsManager,
  compact,
  createAgentSession,
  createExtensionRuntime,
  type AgentSession,
  type ModelRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { wrapModelCallMetrics, type ModelCallClock } from "@/lib/server/model-call-metrics";
import { resolveModelCallContext, runWithLlmAuditContext } from "@/lib/server/llm-audit";
import { recordModelCall, summarize } from "@/lib/server/token-audit-store";
import { GET } from "@/app/api/token-audit/calls/route";

/**
 * Acceptance boundary for issue 05: pi's real compaction/branch-summary entry
 * points (AgentSession.compact / prompt-triggered threshold compaction /
 * navigateTree summarize, plus the SDK's own split-turn `compact()`), driven by
 * a controlled ModelRuntime, stored in a temporary SQLite database and read
 * back through the real per-call route handler.
 *
 * No provider, key, user directory or real session is touched. The file is
 * process-internal, so run it with `PI_WORK_TEST_SKIP_INSTANCE=1` (the shared
 * global setup otherwise starts the isolated instance for every unit file).
 */

let root: string;
let dbCounter = 0;
const tmpDirs: string[] = [];

const originalLogFile = process.env.PI_WORK_LOG_FILE;
process.env.PI_WORK_LOG_FILE = "off";

function resetDbGlobals(): void {
  const g = globalThis as { __piTokenAuditDb?: { close: () => void } };
  g.__piTokenAuditDb?.close();
  delete g.__piTokenAuditDb;
}

function switchToTempDb(name = `compaction-${++dbCounter}`): string {
  resetDbGlobals();
  const file = join(root, `${name}.db`);
  process.env.PI_WORK_TOKEN_AUDIT_DB = file;
  return file;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pi-work-compaction-metrics-"));
});

beforeEach(() => {
  switchToTempDb();
});

afterAll(() => {
  resetDbGlobals();
  delete process.env.PI_WORK_TOKEN_AUDIT_DB;
  if (originalLogFile === undefined) delete process.env.PI_WORK_LOG_FILE;
  else process.env.PI_WORK_LOG_FILE = originalLogFile;
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

// ── fixtures ──────────────────────────────────────────────────────────────

const MODEL = {
  provider: "test-provider",
  id: "test-model",
  api: "test-api",
  contextWindow: 2_000,
  maxTokens: 4_096,
} as const;

function usage(output: number, input = 10) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "test-api",
    provider: "test-provider",
    model: "test-model",
    usage: usage(120),
    stopReason: "stop",
    timestamp: 1_700_000_000_000,
    ...overrides,
  } as AssistantMessage;
}

function delta(value: string): AssistantMessageEvent {
  return { type: "text_delta", contentIndex: 0, delta: value, partial: assistantMessage() } as AssistantMessageEvent;
}

function done(message: AssistantMessage): AssistantMessageEvent {
  return { type: "done", reason: "stop", message } as AssistantMessageEvent;
}

function userMessage(text: string, timestamp: number) {
  return { role: "user", content: text, timestamp } as never;
}

function textMessage(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return assistantMessage({ content: [{ type: "text", text }], ...overrides });
}

function fakeClock(startMonotonic = 0, startWall = 1_700_000_000_000) {
  let monotonic = startMonotonic;
  let wall = startWall;
  const clock: ModelCallClock = { now: () => monotonic, wallNow: () => wall };
  return {
    clock,
    advance(ms: number) {
      monotonic += ms;
      wall += ms;
    },
  };
}

function emptyLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  } as ResourceLoader;
}

interface ControlledRuntimeOptions {
  /** Text of the final assistant message for the n-th (1-based) call. */
  respond?: (callIndex: number) => string;
  outputTokens?: number;
}

interface ControlledRuntime {
  runtime: ModelRuntime;
  calls: () => number;
}

/**
 * Every generation reports 2,000 ms to first output, 6,000 ms to last output
 * and 7,000 ms to the terminal event: TTFT=2000, window=4000, duration=7000.
 * With 120 output tokens that is generation TPS 30 and end-to-end TPS 120/7.
 */
function controlledRuntime(
  clockInfo: ReturnType<typeof fakeClock>,
  options: ControlledRuntimeOptions = {},
): ControlledRuntime {
  let calls = 0;
  const makeStream = (): AssistantMessageEventStream => {
    calls += 1;
    const text = options.respond?.(calls) ?? "generated text";
    const outputTokens = options.outputTokens ?? 120;
    const stream = createAssistantMessageEventStream();
    // Push after the wrapper has installed its observation hook: a provider
    // stream never emits inside the synchronous `streamSimple()` call.
    queueMicrotask(() => {
      clockInfo.advance(2_000);
      stream.push(delta(`${text} `));
      clockInfo.advance(4_000);
      stream.push(delta("done"));
      clockInfo.advance(1_000);
      stream.push(done(textMessage(text, { usage: usage(outputTokens) })));
    });
    return stream;
  };

  const base = {
    stream: makeStream,
    streamSimple: makeStream,
    getModel: () => MODEL,
    getAuth: async () => undefined,
    hasConfiguredAuth: () => true,
    checkAuth: async () => undefined,
  };

  return {
    runtime: wrapModelCallMetrics(base as unknown as ModelRuntime, {
      clock: clockInfo.clock,
      resolveContext: resolveModelCallContext,
      record: recordModelCall,
    }),
    calls: () => calls,
  };
}

function newSessionDir(): string {
  const dir = mkdtempSync(join(root, "session-"));
  tmpDirs.push(dir);
  return dir;
}

interface CreateSessionOptions {
  dir: string;
  runtime: ModelRuntime;
  seed: (manager: SessionManager) => void;
  compaction?: { enabled?: boolean; reserveTokens?: number; keepRecentTokens?: number };
}

async function createSession(options: CreateSessionOptions): Promise<AgentSession> {
  const manager = SessionManager.inMemory(options.dir);
  options.seed(manager);
  const settings = SettingsManager.inMemory({
    compaction: {
      enabled: options.compaction?.enabled ?? true,
      reserveTokens: options.compaction?.reserveTokens ?? 100,
      keepRecentTokens: options.compaction?.keepRecentTokens ?? 100,
    },
  });
  const { session } = await createAgentSession({
    cwd: options.dir,
    agentDir: options.dir,
    sessionManager: manager,
    settingsManager: settings,
    resourceLoader: emptyLoader(),
    modelRuntime: options.runtime,
    model: MODEL as never,
    thinkingLevel: "off",
    noTools: "all",
  });
  return session as AgentSession;
}

function seedTurns(manager: SessionManager, turns: number, chars = 200, lastUsage?: number): void {
  for (let i = 0; i < turns; i += 1) {
    manager.appendMessage(userMessage(`question ${i} ${"x".repeat(chars)}`, Date.now() + i * 2));
    const isLast = i === turns - 1;
    manager.appendMessage(
      textMessage(`answer ${i} ${"y".repeat(chars)}`, {
        usage: usage(100, isLast && lastUsage !== undefined ? lastUsage : 10),
      }),
    );
  }
}

function userContext(dir: string, sessionId = "session-compaction") {
  return { sessionId, source: "user" as const, cwd: dir, sessionName: null };
}

// ── API helpers ───────────────────────────────────────────────────────────

interface TokenCallBody {
  callId: string;
  ts: number;
  sessionId: string | null;
  source: string;
  purpose: string;
  status: string;
  provider: string;
  modelId: string;
  api: string | null;
  outputTokens: number | null;
  durationMs: number | null;
  ttftMs: number | null;
  generationDurationMs: number | null;
  generationTps: number | null;
  endToEndTps: number | null;
}

async function queryCalls(query = "range=all&limit=50"): Promise<{ rows: TokenCallBody[]; total: number }> {
  const response = await GET(new Request(`http://localhost/api/token-audit/calls?${query}`));
  expect(response.status).toBe(200);
  return (await response.json()) as { rows: TokenCallBody[]; total: number };
}

function expectNoBillingRows(): void {
  // Summary calls bypass the assistant `message_end` billing hook, so the
  // existing cost/call summary must not grow because of these records.
  expect(summarize("all", "none").totals.calls).toBe(0);
}

function expectSampleMetrics(call: TokenCallBody): void {
  expect(call).toMatchObject({
    status: "completed",
    provider: "test-provider",
    modelId: "test-model",
    api: "test-api",
    outputTokens: 120,
    ttftMs: 2_000,
    generationDurationMs: 4_000,
    durationMs: 7_000,
    generationTps: 30,
  });
  expect(call.endToEndTps).toBeCloseTo(120 / 7, 10);
}

// ── manual compaction ─────────────────────────────────────────────────────

describe("compaction and branch-summary model calls", () => {
  it("records a manual compaction summary through the real AgentSession entry", async () => {
    const dir = newSessionDir();
    const clockInfo = fakeClock();
    const controlled = controlledRuntime(clockInfo, { respond: () => "manual summary" });
    const session = await createSession({
      dir,
      runtime: controlled.runtime,
      seed: (manager) => seedTurns(manager, 6),
      compaction: { reserveTokens: 1_000, keepRecentTokens: 200 },
    });

    const result = await runWithLlmAuditContext(userContext(dir), () => session.compact());

    expect(result.summary).toBe("manual summary");
    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "compaction",
      source: "user",
      sessionId: "session-compaction",
    });
    expectSampleMetrics(rows[0]);
    // The summary call is a model call, not a chat message: the billing
    // summary still only covers real assistant messages.
    expectNoBillingRows();
    session.dispose();
  });

  it("records every independent generation operation of a split-turn compaction", async () => {
    const dir = newSessionDir();
    const clockInfo = fakeClock();
    const controlled = controlledRuntime(clockInfo, {
      respond: (call) => `summary part ${call}`,
    });

    // The SDK calls `compact()` once for the history and once for the turn
    // prefix when the cut point splits a turn. Both are real generation
    // operations, so both get their own record.
    const preparation = {
      firstKeptEntryId: "kept-entry",
      messagesToSummarize: [userMessage("old question", 1), textMessage("old answer")],
      turnPrefixMessages: [userMessage("current turn", 2)],
      isSplitTurn: true,
      tokensBefore: 1_000,
      previousSummary: undefined,
      fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
      settings: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 100 },
    } as unknown as Parameters<typeof compact>[0];

    const streamFn = ((model: unknown, context: unknown, requestOptions: unknown) =>
      controlled.runtime.streamSimple(model as never, context as never, requestOptions as never)) as never;

    const result = await runWithLlmAuditContext(userContext(dir), () =>
      compact(
        preparation,
        MODEL as never,
        undefined,
        undefined,
        undefined,
        undefined,
        "off",
        streamFn,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    );

    expect(result.summary).toContain("summary part 1");
    expect(result.summary).toContain("summary part 2");
    expect(controlled.calls()).toBe(2);
    const { rows, total } = await queryCalls();
    expect(total).toBe(2);
    expect(rows.every((row) => row.purpose === "compaction")).toBe(true);
    expect(rows[0].callId).not.toBe(rows[1].callId);
    for (const row of rows) {
      expect(row.sessionId).toBe("session-compaction");
      expectSampleMetrics(row);
    }
    expectNoBillingRows();
  });

  it("records auto compaction before a prompt as compaction and keeps the chat call separate", async () => {
    const dir = newSessionDir();
    const clockInfo = fakeClock();
    const controlled = controlledRuntime(clockInfo, {
      respond: (call) => (call === 1 ? "auto summary" : "chat reply"),
    });
    const session = await createSession({
      dir,
      runtime: controlled.runtime,
      // The last assistant usage is already over the tiny context window, so
      // the next prompt compacts before asking the model again.
      seed: (manager) => seedTurns(manager, 8, 3_000, 5_000),
      compaction: { reserveTokens: 100, keepRecentTokens: 3_000 },
    });

    const events: string[] = [];
    const unsubscribe = session.subscribe((event: { type: string }) => {
      if (event.type === "compaction_start" || event.type === "compaction_end") {
        events.push(event.type);
      }
    });

    await runWithLlmAuditContext(userContext(dir), () => session.prompt("hello"));
    unsubscribe();

    expect(events).toEqual(["compaction_start", "compaction_end"]);
    const { rows, total } = await queryCalls();
    expect(total).toBe(2);
    // Rows are newest-first; the chat call is the last generation.
    expect(rows.map((row) => row.purpose)).toEqual(["chat", "compaction"]);
    expectSampleMetrics(rows[0]);
    expectSampleMetrics(rows[1]);
    expect(rows.every((row) => row.sessionId === "session-compaction" && row.source === "user")).toBe(true);
    expectNoBillingRows();
    session.dispose();
  });

  // ── branch summary ──────────────────────────────────────────────────────

  it("records a branch summary through navigateTree with the branch-summary purpose", async () => {
    const dir = newSessionDir();
    const clockInfo = fakeClock();
    const controlled = controlledRuntime(clockInfo, { respond: () => "branch summary" });
    let targetId = "";
    const session = await createSession({
      dir,
      runtime: controlled.runtime,
      seed: (manager) => {
        manager.appendMessage(userMessage("first question", 1));
        targetId = manager.appendMessage(textMessage("first answer"));
        manager.appendMessage(userMessage("second question", 2));
        manager.appendMessage(textMessage("second answer"));
      },
    });

    const result = await runWithLlmAuditContext(userContext(dir), () =>
      session.navigateTree(targetId, { summarize: true }),
    );

    expect(result.cancelled).toBe(false);
    expect(session.sessionManager.getEntry(session.sessionManager.getLeafId() ?? "")?.type).toBe(
      "branch_summary",
    );
    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      purpose: "branch-summary",
      source: "user",
      sessionId: "session-compaction",
    });
    expectSampleMetrics(rows[0]);
    expectNoBillingRows();
    session.dispose();
  });

  it("keeps the detected purpose even when no command scope exists", async () => {
    const clockInfo = fakeClock();
    const controlled = controlledRuntime(clockInfo);
    const context = {
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: "You are a context summarization assistant. Produce a summary." },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "<conversation>\nuser: hi\n</conversation>\n\nThe messages above are a conversation to summarize.",
            },
          ],
        },
      ],
    };

    const stream = controlled.runtime.streamSimple(MODEL as never, context as never, {} as never);
    await stream.result();

    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      purpose: "compaction",
      sessionId: null,
      source: "unknown",
    });
    expectSampleMetrics(rows[0]);
  });

  // ── no model request ────────────────────────────────────────────────────

  it("does not invent a call when the compaction path makes no model request", async () => {
    const dir = newSessionDir();
    const clockInfo = fakeClock();
    const controlled = controlledRuntime(clockInfo);
    const session = await createSession({
      dir,
      runtime: controlled.runtime,
      seed: (manager) => {
        manager.appendMessage(userMessage("only question", 1));
        manager.appendMessage(textMessage("only answer"));
      },
      compaction: { reserveTokens: 1_000, keepRecentTokens: 200 },
    });

    await expect(
      runWithLlmAuditContext(userContext(dir), () => session.compact()),
    ).rejects.toThrow(/Nothing to compact/);
    expect(controlled.calls()).toBe(0);
    const { rows, total } = await queryCalls();
    expect(total).toBe(0);
    expect(rows).toEqual([]);
    session.dispose();
  });
});
