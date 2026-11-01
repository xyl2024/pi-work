import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSandbox } from "./sandbox";
import {
  deleteSuggestions,
  readSuggestions,
  storeSuggestion,
  writeSuggestions,
} from "@/lib/server/suggested-prompt-store";
import { createSuggestionQueue } from "@/lib/server/suggested-prompt-queue";
import { ensureSuggestionForCurrentLeaf } from "@/lib/server/suggested-prompt-background";
import { suggestForSession } from "@/lib/server/suggested-prompt";
import {
  MAX_STORED_SUGGESTIONS,
  TRANSIENT_SUGGESTION_FAILURE_TTL_MS,
  readStoredSuggestionStatus,
  upsertStoredSuggestion,
  type StoredSuggestion,
} from "@/lib/shared/suggested-prompt";

const timestamp = "2026-01-02T03:04:05.000Z";

function writeSession(agentDir: string, id: string): void {
  const dir = path.join(agentDir, "sessions", "--tmp-project--");
  const lines = [
    JSON.stringify({ type: "session", version: 3, id, timestamp, cwd: "/tmp/project" }),
    JSON.stringify({
      type: "message",
      id: "u1",
      parentId: null,
      timestamp,
      message: { role: "user", content: [{ type: "text", text: "给这个接口加上重试" }], timestamp: 0 },
    }),
    JSON.stringify({
      type: "message",
      id: "a2",
      parentId: "u1",
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "重试已经加上" }],
        model: "test-model",
        provider: "test-provider",
        stopReason: "stop",
      },
    }),
  ];
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.jsonl`), lines.join("\n") + "\n", "utf8");
}

const entry = (overrides: Partial<StoredSuggestion> = {}): StoredSuggestion => ({
  leafId: "a2",
  text: "那退避策略呢？",
  reason: null,
  generatedAt: 1000,
  ...overrides,
});

describe("stored suggestion decisions", () => {
  it("reports a hit for a stored suggestion", () => {
    expect(readStoredSuggestionStatus([entry()], "a2", 2000)).toEqual({
      kind: "suggestion",
      text: "那退避策略呢？",
    });
  });

  it("reports a missing leaf", () => {
    expect(readStoredSuggestionStatus([entry()], "other", 2000)).toEqual({ kind: "missing" });
  });

  it("keeps a deterministic failure fresh forever", () => {
    const items = [entry({ text: "", reason: "empty-suggestion", generatedAt: 0 })];
    expect(readStoredSuggestionStatus(items, "a2", 10 * TRANSIENT_SUGGESTION_FAILURE_TTL_MS)).toEqual({
      kind: "failure",
      reason: "empty-suggestion",
      transient: false,
      expired: false,
    });
  });

  it("expires a transient failure after the ttl", () => {
    const items = [entry({ text: "", reason: "generation-failed", generatedAt: 0 })];
    expect(readStoredSuggestionStatus(items, "a2", 1000)).toMatchObject({ expired: false });
    expect(
      readStoredSuggestionStatus(items, "a2", TRANSIENT_SUGGESTION_FAILURE_TTL_MS),
    ).toMatchObject({ expired: true });
  });

  it("keeps the newest entries and drops the oldest", () => {
    const items = Array.from({ length: MAX_STORED_SUGGESTIONS }, (_, i) =>
      entry({ leafId: `leaf-${i}`, generatedAt: i }),
    );
    const next = upsertStoredSuggestion(items, entry({ leafId: "fresh", generatedAt: 99 }));
    expect(next).toHaveLength(MAX_STORED_SUGGESTIONS);
    expect(next[0].leafId).toBe("fresh");
    expect(next.some((item) => item.leafId === "leaf-0")).toBe(false);
  });

  it("replaces the entry for the same leaf instead of duplicating it", () => {
    const next = upsertStoredSuggestion([entry()], entry({ text: "换个问题", generatedAt: 2000 }));
    expect(next).toHaveLength(1);
    expect(next[0].text).toBe("换个问题");
  });
});

describe("suggested prompt sidecar", () => {
  it("round-trips entries per session", () => {
    createSandbox("pi-work-suggested-prompt-store-");
    storeSuggestion("session-a", entry());
    storeSuggestion("session-b", entry({ leafId: "b1", text: "另一个会话" }));

    expect(readSuggestions("session-a")).toEqual([entry()]);
    expect(readSuggestions("session-b")[0].text).toBe("另一个会话");
  });

  it("refuses session ids that could escape the sidecar directory", () => {
    createSandbox("pi-work-suggested-prompt-store-");
    expect(storeSuggestion("../escape", entry())).toBe(false);
    expect(readSuggestions("../../etc/passwd")).toEqual([]);
  });

  it("ignores a corrupt sidecar file", () => {
    const sandbox = createSandbox("pi-work-suggested-prompt-store-");
    writeSuggestions("session-c", [entry()]);
    const dir = path.join(sandbox.dataDir, "suggested-prompts");
    writeFileSync(path.join(dir, "session-c.json"), "{ not json", "utf8");

    expect(readSuggestions("session-c")).toEqual([]);
  });

  it("writes through a temporary file", () => {
    const sandbox = createSandbox("pi-work-suggested-prompt-store-");
    writeSuggestions("session-d", [entry()]);

    const dir = path.join(sandbox.dataDir, "suggested-prompts");
    expect(readdirSync(dir).filter((file) => file.includes(".tmp."))).toEqual([]);
    expect(readFileSync(path.join(dir, "session-d.json"), "utf8")).toContain("a2");
  });

  it("drops the sidecar when the session is deleted", () => {
    const sandbox = createSandbox("pi-work-suggested-prompt-store-");
    writeSuggestions("session-e", [entry()]);
    deleteSuggestions("session-e");

    expect(existsSync(path.join(sandbox.dataDir, "suggested-prompts", "session-e.json"))).toBe(false);
  });
});

describe("suggested prompt queue", () => {
  it("shares one promise for the same key", async () => {
    const queue = createSuggestionQueue(2);
    let calls = 0;
    const task = () => {
      calls += 1;
      return new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5));
    };

    const [first, second] = await Promise.all([queue.run("s", task), queue.run("s", task)]);

    expect(first).toBe("done");
    expect(second).toBe("done");
    expect(calls).toBe(1);
  });

  it("never runs more than the limit at once, and drains the backlog", async () => {
    const queue = createSuggestionQueue(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };

    await Promise.all(
      ["a", "b", "c", "d", "e"].map((key) => queue.run(key, task)),
    );

    expect(peak).toBe(2);
    expect(queue.active()).toBe(0);
    expect(queue.pending()).toBe(0);
  });

  it("lets a failed task release its slot", async () => {
    const queue = createSuggestionQueue(1);
    await expect(queue.run("a", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(queue.run("b", () => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("runs the same key again once the first task settled", async () => {
    const queue = createSuggestionQueue(1);
    let calls = 0;
    const task = async () => {
      calls += 1;
      return calls;
    };

    await queue.run("s", task);
    await queue.run("s", task);

    expect(calls).toBe(2);
  });
});

const generator = async () => "那退避策略呢？";

describe("background suggestion generation", () => {
  it("stores the suggestion and publishes it to the session listeners", async () => {
    const sandbox = createSandbox("pi-work-suggested-prompt-background-");
    writeSession(sandbox.agentDir, "session-bg");
    const published: Array<{ leafId: string; suggestion: string }> = [];

    const outcome = await ensureSuggestionForCurrentLeaf("session-bg", {
      generate: generator,
      onSuggestion: (publication) => published.push(publication),
    });

    expect(outcome).toEqual({ kind: "suggestion", suggestion: "那退避策略呢？", leafId: "a2" });
    expect(published).toEqual([{ leafId: "a2", suggestion: "那退避策略呢？", generatedAt: expect.any(Number) }]);
    expect(readSuggestions("session-bg")[0]).toMatchObject({ leafId: "a2", text: "那退避策略呢？" });
  });

  it("does not pay for the same leaf twice", async () => {
    const sandbox = createSandbox("pi-work-suggested-prompt-background-");
    writeSession(sandbox.agentDir, "session-bg2");
    await ensureSuggestionForCurrentLeaf("session-bg2", { generate: generator });

    let calls = 0;
    const outcome = await suggestForSession({
      sessionId: "session-bg2",
      generate: async () => {
        calls += 1;
        return "不该再调用";
      },
    });

    expect(calls).toBe(0);
    expect(outcome).toMatchObject({ kind: "suggestion", leafId: "a2" });
  });

  it("reports a missing session without publishing anything", async () => {
    createSandbox("pi-work-suggested-prompt-background-");
    const published: unknown[] = [];

    const outcome = await ensureSuggestionForCurrentLeaf("missing-session", {
      generate: generator,
      onSuggestion: (publication) => published.push(publication),
    });

    expect(outcome).toEqual({ kind: "none", reason: "session-not-found" });
    expect(published).toEqual([]);
  });
});
