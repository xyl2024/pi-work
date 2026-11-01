import { describe, expect, it } from "vitest";
import {
  compareSubagentTaskIdDesc,
  projectSubagentSessionGroups,
} from "@/lib/shared/subagent-sessions";
import type {
  SubagentSessionStatsView,
  SubagentTaskSummary,
} from "@/lib/shared/types";

function task(
  taskId: string,
  overrides: Partial<SubagentTaskSummary> = {},
): SubagentTaskSummary {
  return {
    taskId,
    childSessionId: null,
    subagentName: "codebase_explorer",
    description: `task ${taskId}`,
    status: "completed",
    origin: "tool",
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function stats(
  sessionId: string,
  overrides: Partial<SubagentSessionStatsView> = {},
): SubagentSessionStatsView {
  return {
    sessionId,
    title: `title ${sessionId}`,
    assistantCount: 1,
    toolCallCount: null,
    avgTtftMs: null,
    avgGenerationTps: null,
    model: null,
    context: null,
    ...overrides,
  };
}

describe("compareSubagentTaskIdDesc", () => {
  it("compares task ids numerically instead of lexicographically", () => {
    expect(compareSubagentTaskIdDesc("9999", "10000")).toBeGreaterThan(0);
    expect(compareSubagentTaskIdDesc("10000", "9999")).toBeLessThan(0);
    expect(compareSubagentTaskIdDesc("0002", "0001")).toBeLessThan(0);
  });

  it("keeps non-numeric ids after numeric ids", () => {
    expect(compareSubagentTaskIdDesc("subagent:abc", "0001")).toBeGreaterThan(0);
    expect(compareSubagentTaskIdDesc("0001", "subagent:abc")).toBeLessThan(0);
    expect(compareSubagentTaskIdDesc("subagent:abc", "subagent:def")).toBe(0);
  });
});

describe("projectSubagentSessionGroups", () => {
  it("groups multiple tasks of one session and splits the latest task from history", () => {
    const session = stats("child-1");
    const projection = projectSubagentSessionGroups(
      [
        task("0001", { childSessionId: "child-1", description: "oldest" }),
        task("0003", { childSessionId: "child-1", description: "newest" }),
        task("0002", { childSessionId: "child-1", description: "middle" }),
      ],
      [session],
    );

    expect(projection.taskCount).toBe(3);
    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0].sessionId).toBe("child-1");
    expect(projection.groups[0].latestTask.description).toBe("newest");
    expect(projection.groups[0].historyTasks.map((item) => item.description)).toEqual([
      "middle",
      "oldest",
    ]);
    expect(projection.groups[0].stats).toBe(session);
  });

  it("orders interleaved sessions by their latest task id", () => {
    const projection = projectSubagentSessionGroups(
      [
        task("0001", { childSessionId: "child-a" }),
        task("0002", { childSessionId: "child-b" }),
        task("0004", { childSessionId: "child-a" }),
        task("0003", { childSessionId: "child-b" }),
      ],
      null,
    );

    expect(projection.groups.map((group) => group.sessionId)).toEqual(["child-a", "child-b"]);
    expect(projection.groups.map((group) => group.latestTask.taskId)).toEqual(["0004", "0003"]);
  });

  it("orders ids past four digits numerically", () => {
    const projection = projectSubagentSessionGroups(
      [
        task("9999", { childSessionId: "child-a" }),
        task("10000", { childSessionId: "child-b" }),
        task("9998", { childSessionId: "child-b" }),
      ],
      [],
    );

    expect(projection.groups.map((group) => group.sessionId)).toEqual(["child-b", "child-a"]);
    expect(projection.groups[0].historyTasks.map((item) => item.taskId)).toEqual(["9998"]);
  });

  it("keeps non-numeric task ids after numeric ids in input order", () => {
    const projection = projectSubagentSessionGroups(
      [
        task("subagent:first", { childSessionId: "child-a" }),
        task("0001", { childSessionId: "child-a" }),
        task("subagent:second", { childSessionId: "child-a" }),
      ],
      [],
    );

    expect(projection.groups[0].latestTask.taskId).toBe("0001");
    expect(projection.groups[0].historyTasks.map((item) => item.taskId)).toEqual([
      "subagent:first",
      "subagent:second",
    ]);
  });

  it("gives every task without a child session its own group", () => {
    const projection = projectSubagentSessionGroups(
      [
        task("0001", { childSessionId: null }),
        task("0002", { childSessionId: null }),
        task("0003", { childSessionId: "child-1" }),
      ],
      [stats("child-1"), stats("task:0001")],
    );

    expect(projection.groups.map((group) => group.sessionId)).toEqual([
      "child-1",
      "task:0002",
      "task:0001",
    ]);
    expect(projection.groups[1].stats).toBeNull();
    expect(projection.groups[2].stats).toBeNull();
  });

  it("returns no groups for an empty task list", () => {
    const projection = projectSubagentSessionGroups([], [stats("child-1")]);
    expect(projection).toEqual({ groups: [], taskCount: 0 });
  });

  it("leaves stats null when sessions are missing", () => {
    const tasks = [task("0001", { childSessionId: "child-1" })];
    expect(projectSubagentSessionGroups(tasks, undefined).groups[0].stats).toBeNull();
    expect(projectSubagentSessionGroups(tasks, null).groups[0].stats).toBeNull();
    expect(projectSubagentSessionGroups(tasks, []).groups[0].stats).toBeNull();
  });

  it("attaches only one stats record per group", () => {
    const projection = projectSubagentSessionGroups(
      [
        task("0001", { childSessionId: "child-1" }),
        task("0002", { childSessionId: "child-1" }),
      ],
      [stats("child-1", { assistantCount: 3 })],
    );

    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0].stats).toMatchObject({
      sessionId: "child-1",
      assistantCount: 3,
    });
  });
});
