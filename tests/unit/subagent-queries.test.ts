import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SUBAGENT_RESULT_WINDOW_DEFAULT,
  sliceSubagentText,
} from "@/lib/shared/subagent";
import { SUBAGENT_TERMINAL_STATUSES, type SubagentTaskStatus } from "@/lib/shared/types";
import {
  SubagentQueryError,
  getSubagentSessionDetail,
  getSubagentTaskDetail,
  listSubagentSessions,
  resolveSubagentTaskStatus,
  toSubagentTaskView,
} from "@/lib/server/subagent-queries";
import {
  completeSubagentTask,
  createSubagentTask,
  failSubagentTask,
  findSubagentTask,
  getSubagentTask,
  markSubagentRunning,
  setSubagentTaskPartialOutput,
} from "@/lib/server/subagent-store";
import {
  setSubagentTaskManagerForTests,
  type SubagentTaskManager,
} from "@/lib/server/subagent-tasks";

/**
 * Read-side behavior of the subagent lifecycle: list grouping/paging/filtering,
 * task and session lookups, bounded windows, ownership and the "effective"
 * status that keeps a dead `running` row from being polled forever.
 *
 * Rows live in a temp `subagents.db`; the transcript/activity cases write a real
 * child session JSONL under a temp agent dir. Neither `~/.pi` nor `~/.pi-work`
 * is touched.
 */

let dir: string;
let agentDir: string;
let savedAgentDir: string | undefined;
const live = new Map<string, SubagentTaskStatus>();

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSubagentsDb;
  delete g.__piSubagentProfilesSeeded;
  delete g.__piSubagentLiveCache;
  delete g.__piSubagentStatsCache;
  delete g.__piSessionPathCache;
  delete g.__piSessionListCache;
  delete g.__piSessionListHeaderCache;
  delete g.__piSessionListInflight;
  delete g.__piSessionListHeaderInflight;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-queries-"));
  agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = dir;
  process.env.PI_WORK_SUBAGENTS_DB = join(dir, "subagents.db");
});

afterAll(() => {
  resetGlobals();
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.PI_WORK_SUBAGENTS_DB;
  if (savedAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetGlobals();
  live.clear();
  // A manager that manages nothing: any non-terminal row the test leaves behind
  // must then be reported as interrupted, not as running.
  const manager: SubagentTaskManager = {
    spawn() {
      throw new Error("spawn is not used by the query tests");
    },
    continue() {
      throw new Error("continue is not used by the query tests");
    },
    async wait() {
      throw new Error("wait is not used by the query tests");
    },
    stop() {},
    stopAll() {
      return { stopped: 0, stopping: false };
    },
    isStopping() {
      return false;
    },
    get: (parentSessionId, taskId) => getSubagentTask(parentSessionId, taskId),
    liveStatus: (_parentSessionId, taskId) => live.get(taskId) ?? null,
    async idle() {},
  };
  setSubagentTaskManagerForTests(manager);
});

afterEach(() => {
  setSubagentTaskManagerForTests(null);
});

/** A child session file the way pi writes it: header + message entries. */
function writeChildSession(
  sessionId: string,
  messages: Array<{ role: string; content: unknown }>,
): void {
  const sessionDir = join(agentDir, "sessions", "--tmp-project--");
  mkdirSync(sessionDir, { recursive: true });
  const header = JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/tmp/project",
  }) + "\n";
  let parentId: string | null = null;
  const entries = messages.map((message, index) => {
    const entryId = `e${index}`;
    const line = JSON.stringify({
      type: "message",
      id: entryId,
      parentId,
      timestamp: new Date(Date.UTC(2026, 0, 2, 3, 4, 6 + index)).toISOString(),
      message: { role: message.role, timestamp: 1, content: message.content },
    }) + "\n";
    parentId = entryId;
    return line;
  });
  writeFileSync(join(sessionDir, `${sessionId}.jsonl`), [header, ...entries].join(""), "utf8");
  resetGlobals();
}

interface SeedInput {
  parent: string;
  child?: string | null;
  status?: SubagentTaskStatus;
  description?: string;
  subagentName?: string;
  result?: string;
  error?: string;
}

/** Create one persisted task in the requested state. */
function seedTask(input: SeedInput): string {
  const taskId = `subagent:${randomUUID()}`;
  createSubagentTask({
    taskId,
    parentSessionId: input.parent,
    subagentName: input.subagentName ?? "codebase_explorer",
    description: input.description ?? "explore the repo",
    prompt: "the prompt",
  });
  const status = input.status ?? "running";
  const child = input.child ?? null;
  if (child && status !== "queued") markSubagentRunning(input.parent, taskId, child);
  if (status === "completed") completeSubagentTask(input.parent, taskId, input.result ?? "done");
  else if (status === "failed" || status === "cancelled" || status === "interrupted") {
    failSubagentTask(input.parent, taskId, input.error ?? "boom", status);
    if (input.result) setSubagentTaskPartialOutput(input.parent, taskId, input.result);
  }
  return taskId;
}

describe("sliceSubagentText", () => {
  const text = "abcdefghij";

  it("returns the whole text when it fits and marks nothing as truncated", () => {
    const window = sliceSubagentText(text, 0, 40);
    expect(window).toMatchObject({
      text,
      offset: 0,
      total: 10,
      truncated: false,
      skipped: 0,
      remaining: 0,
      nextOffset: null,
    });
  });

  it("reports both ends of a middle window with the next offset", () => {
    expect(sliceSubagentText(text, 3, 4)).toMatchObject({
      text: "defg",
      offset: 3,
      truncated: true,
      skipped: 3,
      remaining: 3,
      nextOffset: 7,
    });
  });

  it("clamps offsets outside the text instead of returning garbage", () => {
    expect(sliceSubagentText(text, 99, 4)).toMatchObject({ text: "", offset: 10, truncated: true, nextOffset: null });
    expect(sliceSubagentText(text, -5, 4)).toMatchObject({ text: "abcd", offset: 0 });
  });
});

describe("list", () => {
  it("lists one row per child session with its newest task and no duplicates", () => {
    const parent = "parent-group";
    seedTask({ parent, child: "child-1", status: "completed", description: "first" });
    seedTask({ parent, child: "child-1", status: "running", description: "second" });
    seedTask({ parent, child: "child-2", status: "completed", description: "other session" });

    const list = listSubagentSessions({ parentSessionId: parent });

    expect(list.total).toBe(2);
    expect(list.entries.map((entry) => entry.sessionId)).toEqual(["child-2", "child-1"]);
    expect(new Set(list.entries.map((entry) => entry.sessionId)).size).toBe(list.entries.length);
    const child1 = list.entries.find((entry) => entry.sessionId === "child-1")!;
    expect(child1.latestTask.description).toBe("second");
    expect(child1.taskCount).toBe(2);
  });

  it("keeps a queued task without a child session as its own row", () => {
    const parent = "parent-queued";
    const taskId = seedTask({ parent, status: "queued", description: "waiting for a slot" });
    live.set(taskId, "queued");

    const list = listSubagentSessions({ parentSessionId: parent });
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0].sessionId).toBeNull();
    expect(list.entries[0].latestTask.status).toBe("queued");
  });

  it("pages with limit/offset and reports whether more rows exist", () => {
    const parent = "parent-page";
    for (const child of ["child-a", "child-b", "child-c"]) {
      seedTask({ parent, child, status: "completed" });
    }

    const first = listSubagentSessions({ parentSessionId: parent, limit: 2, offset: 0 });
    expect(first.entries.map((entry) => entry.sessionId)).toEqual(["child-c", "child-b"]);
    expect(first).toMatchObject({ total: 3, limit: 2, offset: 0, hasMore: true });

    const second = listSubagentSessions({ parentSessionId: parent, limit: 2, offset: 2 });
    expect(second.entries.map((entry) => entry.sessionId)).toEqual(["child-a"]);
    expect(second.hasMore).toBe(false);

    const past = listSubagentSessions({ parentSessionId: parent, limit: 2, offset: 10 });
    expect(past.entries).toEqual([]);
    expect(past.total).toBe(3);
  });

  it("filters by the effective status of the newest task", () => {
    const parent = "parent-filter";
    seedTask({ parent, child: "child-done", status: "completed" });
    const running = seedTask({ parent, child: "child-live", status: "running" });
    live.set(running, "running");
    // A row left behind by a dead process is not "running" any more.
    seedTask({ parent, child: "child-stale", status: "running" });

    const runningList = listSubagentSessions({ parentSessionId: parent, status: "running" });
    expect(runningList.entries.map((entry) => entry.sessionId)).toEqual(["child-live"]);
    expect(runningList.status).toBe("running");

    const interruptedList = listSubagentSessions({ parentSessionId: parent, status: "interrupted" });
    expect(interruptedList.entries.map((entry) => entry.sessionId)).toEqual(["child-stale"]);
  });

  it("never returns another parent's sessions", () => {
    seedTask({ parent: "parent-a", child: "child-a", status: "completed" });
    seedTask({ parent: "parent-b", child: "child-b", status: "completed" });

    const list = listSubagentSessions({ parentSessionId: "parent-a" });
    expect(list.entries.map((entry) => entry.sessionId)).toEqual(["child-a"]);
  });
});

describe("effective status", () => {
  it("reports an unmanaged non-terminal row as interrupted without rewriting it", () => {
    const taskId = seedTask({ parent: "parent-stale", child: "child-stale", status: "running" });
    const row = findSubagentTask(taskId)!;

    expect(resolveSubagentTaskStatus(row)).toBe("interrupted");
    expect(toSubagentTaskView(row).status).toBe("interrupted");
    // This query only reports; rewriting stale rows is the manager's job when
    // it starts (`reconcileInterruptedSubagentTasks`).
    expect(findSubagentTask(taskId)!.status).toBe("running");
  });

  it("keeps a terminal row terminal even when a late live status disagrees", () => {
    const taskId = seedTask({ parent: "parent-terminal", child: "child-done", status: "completed" });
    live.set(taskId, "running");
    expect(resolveSubagentTaskStatus(findSubagentTask(taskId)!)).toBe("completed");
  });

  it("trusts the live manager for a task it still manages", () => {
    const taskId = seedTask({ parent: "parent-live", child: "child-live", status: "running" });
    live.set(taskId, "stopping");
    expect(resolveSubagentTaskStatus(findSubagentTask(taskId)!)).toBe("stopping");
  });
});

describe("get by task_id", () => {
  it("returns timing, the bounded result and the offset that continues it", async () => {
    const parent = "parent-result";
    const text = "x".repeat(SUBAGENT_RESULT_WINDOW_DEFAULT + 250);
    const taskId = seedTask({ parent, child: "child-result", status: "completed", result: text });

    const first = await getSubagentTaskDetail({ parentSessionId: parent, taskId });
    expect(first.task).toMatchObject({ taskId, status: "completed", childSessionId: "child-result" });
    expect(first.task.startedAt).toBeTypeOf("number");
    expect(first.task.finishedAt).toBeTypeOf("number");
    expect(first.result).toMatchObject({
      offset: 0,
      total: text.length,
      truncated: true,
      remaining: 250,
      nextOffset: SUBAGENT_RESULT_WINDOW_DEFAULT,
    });
    expect(first.result!.text).toHaveLength(SUBAGENT_RESULT_WINDOW_DEFAULT);

    const rest = await getSubagentTaskDetail({
      parentSessionId: parent,
      taskId,
      resultOffset: first.result!.nextOffset!,
    });
    // The tail still "skips" the earlier window: the caller can tell that this
    // is not the whole result, and there is nothing left to read.
    expect(rest.result).toMatchObject({
      offset: SUBAGENT_RESULT_WINDOW_DEFAULT,
      skipped: SUBAGENT_RESULT_WINDOW_DEFAULT,
      remaining: 0,
      nextOffset: null,
    });
    expect(rest.result!.text).toHaveLength(250);
  });

  it("exposes the partial output an abnormal stop left behind", async () => {
    const parent = "parent-partial";
    const taskId = seedTask({
      parent,
      child: "child-partial",
      status: "failed",
      error: "Subagent cancelled",
      result: "half an answer",
    });

    const detail = await getSubagentTaskDetail({ parentSessionId: parent, taskId });
    expect(detail.task).toMatchObject({ status: "failed", error: "Subagent cancelled" });
    expect(detail.result?.text).toBe("half an answer");
  });

  it("has no result window for a task that has not produced one", async () => {
    const parent = "parent-none";
    const taskId = seedTask({ parent, child: "child-live", status: "running" });
    live.set(taskId, "running");

    const detail = await getSubagentTaskDetail({ parentSessionId: parent, taskId });
    expect(detail.task.status).toBe("running");
    expect(detail.result).toBeNull();
    expect(detail.transcript).toBeNull();
  });

  it("refuses a task id that belongs to another parent", async () => {
    const taskId = seedTask({ parent: "parent-owner", child: "child-owner", status: "completed" });

    await expect(getSubagentTaskDetail({ parentSessionId: "parent-other", taskId }))
      .rejects.toBeInstanceOf(SubagentQueryError);
  });

  it("refuses an unknown task id", async () => {
    await expect(getSubagentTaskDetail({ parentSessionId: "parent-any", taskId: "subagent:nope" }))
      .rejects.toBeInstanceOf(SubagentQueryError);
  });

  it("reports recent tool activity with its total count", async () => {
    const parent = "parent-activity";
    writeChildSession("child-activity", [
      { role: "user", content: [{ type: "text", text: "explore" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "reading" },
          { type: "toolCall", toolCallId: "t1", toolName: "read", input: { path: "/a.ts" } },
          { type: "toolCall", toolCallId: "t2", toolName: "read", input: { path: "/b.ts" } },
          { type: "toolCall", toolCallId: "t3", toolName: "codemode", input: { input: "grep" } },
        ],
      },
    ]);
    const taskId = seedTask({ parent, child: "child-activity", status: "completed", result: "here" });

    const detail = await getSubagentTaskDetail({ parentSessionId: parent, taskId, activityLimit: 2 });
    expect(detail.activityCount).toBe(3);
    expect(detail.activities.map((activity) => activity.toolName)).toEqual(["read", "codemode"]);
    expect(detail.activities[0].summary).toBe("/b.ts");

    // The reader caches by session mtime, so a second, narrower read must still
    // get its own slice (and a zero window must not leak the cached array).
    const narrower = await getSubagentTaskDetail({ parentSessionId: parent, taskId, activityLimit: 1 });
    expect(narrower.activities).toHaveLength(1);
    expect(narrower.activityCount).toBe(3);
    const none = await getSubagentTaskDetail({ parentSessionId: parent, taskId, activityLimit: 0 });
    expect(none.activities).toEqual([]);
    expect(none.activityCount).toBe(3);
  });

  it("pages the child transcript and marks per-message truncation", async () => {
    const parent = "parent-transcript";
    writeChildSession("child-transcript", [
      { role: "user", content: [{ type: "text", text: "first question" }] },
      { role: "assistant", content: [{ type: "text", text: "a".repeat(2_500) }] },
      {
        role: "assistant",
        content: [{ type: "toolCall", toolCallId: "t1", toolName: "read", input: { path: "/x.ts" } }],
      },
      { role: "user", content: [{ type: "text", text: "third message" }] },
    ]);
    const taskId = seedTask({ parent, child: "child-transcript", status: "completed", result: "ok" });

    const page = await getSubagentTaskDetail({
      parentSessionId: parent,
      taskId,
      transcriptOffset: 0,
      transcriptLimit: 2,
    });
    expect(page.transcript).toMatchObject({ total: 4, offset: 0, limit: 2, hasMore: true, nextOffset: 2 });
    expect(page.transcript!.messages[0]).toMatchObject({ role: "user", text: "first question" });
    expect(page.transcript!.messages[1]).toMatchObject({ role: "assistant", truncated: true });
    expect(page.transcript!.messages[1].text).toHaveLength(2_000);
    expect(page.transcript!.messages[1]).toMatchObject({ totalLength: 2_500, skipped: 0, nextCharOffset: 2_000 });

    // Continuing the truncated message: same message index, bumped char offset.
    const messageRest = await getSubagentTaskDetail({
      parentSessionId: parent,
      taskId,
      transcriptOffset: 1,
      transcriptLimit: 1,
      transcriptCharOffset: 2_000,
    });
    expect(messageRest.transcript!.messages).toHaveLength(1);
    expect(messageRest.transcript!.messages[0]).toMatchObject({
      totalLength: 2_500,
      skipped: 2_000,
      nextCharOffset: null,
    });
    expect(messageRest.transcript!.messages[0].text).toHaveLength(500);

    const tail = await getSubagentTaskDetail({
      parentSessionId: parent,
      taskId,
      transcriptOffset: 2,
      transcriptLimit: 2,
    });
    expect(tail.transcript).toMatchObject({ offset: 2, hasMore: false, nextOffset: null });
    expect(tail.transcript!.messages[0].text).toBe("[tool read] /x.ts");
    expect(tail.transcript!.messages.map((message) => message.text)).toEqual(["[tool read] /x.ts", "third message"]);
  });
});

describe("get by session_id", () => {
  it("returns the newest task detail plus a paged history of that session", async () => {
    const parent = "parent-session";
    seedTask({ parent, child: "child-session", status: "completed", description: "oldest", result: "old" });
    seedTask({ parent, child: "child-session", status: "failed", description: "middle", error: "boom" });
    const newest = seedTask({ parent, child: "child-session", status: "completed", description: "newest", result: "fresh" });

    const detail = await getSubagentSessionDetail({ parentSessionId: parent, sessionId: "child-session", limit: 2 });
    expect(detail).toMatchObject({ sessionId: "child-session", taskCount: 3 });
    expect(detail.latest.task).toMatchObject({ taskId: newest, description: "newest", status: "completed" });
    expect(detail.latest.result?.text).toBe("fresh");
    expect(detail.tasks.items.map((task) => task.description)).toEqual(["newest", "middle"]);
    expect(detail.tasks).toMatchObject({ total: 3, offset: 0, limit: 2, hasMore: true });

    const older = await getSubagentSessionDetail({
      parentSessionId: parent,
      sessionId: "child-session",
      limit: 2,
      offset: 2,
    });
    expect(older.tasks.items.map((task) => task.description)).toEqual(["oldest"]);
    expect(older.tasks.hasMore).toBe(false);
  });

  it("refuses a session id that does not belong to this parent", async () => {
    seedTask({ parent: "parent-owner", child: "child-owner", status: "completed" });

    await expect(getSubagentSessionDetail({ parentSessionId: "parent-other", sessionId: "child-owner" }))
      .rejects.toBeInstanceOf(SubagentQueryError);
  });

  it("refuses an unknown session id", async () => {
    await expect(getSubagentSessionDetail({ parentSessionId: "parent-any", sessionId: "child-nope" }))
      .rejects.toBeInstanceOf(SubagentQueryError);
  });
});

describe("terminal statuses", () => {
  it("never reports a terminal row as live", () => {
    expect(SUBAGENT_TERMINAL_STATUSES).toEqual(["completed", "failed", "cancelled", "interrupted"]);
  });
});
