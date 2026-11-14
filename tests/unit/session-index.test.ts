import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listAllSessionsHeaderOnly } from "@/lib/server/sessions/reader";
import { writeSessionName } from "@/lib/server/session-names";

const created: string[] = [];
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const savedDataDir = process.env.PI_WORK_DATA_DIR;

function sandbox(): { agentDir: string; dataDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "pi-work-session-index-"));
  created.push(root);
  const agentDir = path.join(root, "agent");
  const dataDir = path.join(root, "data");
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = dataDir;
  return { agentDir, dataDir };
}

function headerLine(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/tmp/project",
    ...extra,
  }) + "\n";
}

function messageLine(id: string, role: "user" | "assistant", text: string): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-02T03:04:06.000Z",
    message: { role, timestamp: 1, content: [{ type: "text", text }] },
  }) + "\n";
}

function sessionInfoLine(id: string, name: string): string {
  return JSON.stringify({
    type: "session_info",
    id,
    parentId: null,
    timestamp: "2026-01-02T03:04:07.000Z",
    name,
  }) + "\n";
}

function writeSession(agentDir: string, fileName: string, ...lines: string[]): string {
  const dir = path.join(agentDir, "sessions", "--tmp-project--");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, lines.join(""), "utf8");
  return filePath;
}

function clearCaches(): void {
  const g = globalThis as Record<string, unknown>;
  for (const key of Object.keys(g)) {
    if (key.startsWith("__piSession")) delete g[key];
  }
}

function touch(filePath: string, secondsFromNow: number): void {
  const at = new Date(statSync(filePath).mtimeMs + secondsFromNow * 1000);
  utimesSync(filePath, at, at);
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  if (savedDataDir === undefined) delete process.env.PI_WORK_DATA_DIR;
  else process.env.PI_WORK_DATA_DIR = savedDataDir;
  clearCaches();
});

describe("the listing tracks the session directory without a staleness window", () => {
  it("reflects a renamed session on the very next listing", async () => {
    const { agentDir } = sandbox();
    const filePath = writeSession(agentDir, "a.jsonl", headerLine("a-1"), messageLine("u1", "user", "first"));
    clearCaches();

    expect((await listAllSessionsHeaderOnly()).find((s) => s.id === "a-1")?.name).toBeUndefined();

    appendFileSync(filePath, sessionInfoLine("si1", "renamed"), "utf8");
    touch(filePath, 5);

    expect((await listAllSessionsHeaderOnly()).find((s) => s.id === "a-1")?.name).toBe("renamed");
  });

  it("drops a session whose file disappeared and keeps the survivors", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "a.jsonl", headerLine("a-1"));
    const gonePath = writeSession(agentDir, "b.jsonl", headerLine("b-1"));
    clearCaches();

    expect((await listAllSessionsHeaderOnly()).map((s) => s.id).sort()).toEqual(["a-1", "b-1"]);

    rmSync(gonePath);

    expect((await listAllSessionsHeaderOnly()).map((s) => s.id)).toEqual(["a-1"]);
  });

  it("picks up a brand new session and its recency", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "a.jsonl", headerLine("a-1"));
    clearCaches();
    await listAllSessionsHeaderOnly();

    const freshPath = writeSession(agentDir, "b.jsonl", headerLine("b-1"));
    touch(freshPath, 60);

    const listed = await listAllSessionsHeaderOnly();
    expect(listed.map((s) => s.id)).toEqual(["b-1", "a-1"]);
    expect(listed[0].modified).toBe(new Date(statSync(freshPath).mtimeMs).toISOString());
  });

  it("lists a session only once when two files carry the same id", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "a.jsonl", headerLine("dup-1"));
    writeSession(agentDir, "b.jsonl", headerLine("dup-1"));
    clearCaches();

    const listed = await listAllSessionsHeaderOnly();
    expect(listed.filter((s) => s.id === "dup-1")).toHaveLength(1);
  });

  it("keeps the parent link even when the child file is scanned first", async () => {
    const { agentDir } = sandbox();
    const parentPath = writeSession(agentDir, "z-parent.jsonl", headerLine("parent-1"));
    writeSession(agentDir, "a-child.jsonl", headerLine("child-1", { parentSession: parentPath }));
    clearCaches();

    const listed = await listAllSessionsHeaderOnly();
    expect(listed.find((s) => s.id === "child-1")?.parentSessionId).toBe("parent-1");
  });
});

describe("the session name does not require reading the whole file", () => {
  it("finds a name written after a megabyte of conversation", async () => {
    const { agentDir } = sandbox();
    const bulk = messageLine("u1", "user", "x".repeat(1024 * 1024));
    const filePath = writeSession(agentDir, "long.jsonl", headerLine("long-1"), bulk);
    appendFileSync(filePath, sessionInfoLine("si1", "late name"), "utf8");
    clearCaches();

    expect((await listAllSessionsHeaderOnly()).find((s) => s.id === "long-1")?.name).toBe("late name");
  });

  it("prefers the last name in the file", async () => {
    const { agentDir } = sandbox();
    writeSession(
      agentDir,
      "names.jsonl",
      headerLine("names-1"),
      messageLine("u1", "user", "hello"),
      sessionInfoLine("si1", "first name"),
      messageLine("a1", "assistant", "hi"),
      sessionInfoLine("si2", "second name"),
      messageLine("u2", "user", "again"),
    );
    clearCaches();

    expect((await listAllSessionsHeaderOnly()).find((s) => s.id === "names-1")?.name).toBe("second name");
  });

  it("lets the name sidecar win over the file", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "sidecar.jsonl", headerLine("sidecar-1"), messageLine("u1", "user", "hello"), sessionInfoLine("si1", "file name"));
    clearCaches();
    writeSessionName("sidecar-1", "sidecar name");

    expect((await listAllSessionsHeaderOnly()).find((s) => s.id === "sidecar-1")?.name).toBe("sidecar name");
  });
});

describe("the listing does not block the event loop", () => {
  it("keeps timers firing while a many-file listing is in flight", async () => {
    const { agentDir } = sandbox();
    for (let i = 0; i < 300; i += 1) {
      writeSession(agentDir, `s${i}.jsonl`, headerLine(`bulk-${i}`), messageLine("u1", "user", `message ${i}`));
    }
    clearCaches();

    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 2);
    try {
      const listed = await listAllSessionsHeaderOnly();
      expect(listed).toHaveLength(300);
    } finally {
      clearInterval(timer);
    }

    expect(ticks).toBeGreaterThan(0);
  });
});

describe("sidecar and disk caches never serve stale answers", () => {
  it("shows a name written after the listing already ran", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "a.jsonl", headerLine("aaaa-1"));
    clearCaches();
    await listAllSessionsHeaderOnly();

    writeSessionName("aaaa-1", "fresh name");

    expect((await listAllSessionsHeaderOnly()).find((s) => s.id === "aaaa-1")?.name).toBe("fresh name");
  });

  it("rebuilds instead of throwing when the disk index is corrupt", async () => {
    const { agentDir, dataDir } = sandbox();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, "session-index.json"), "{ not json", "utf8");
    writeSession(agentDir, "a.jsonl", headerLine("a-1"), messageLine("u1", "user", "hello"));
    clearCaches();

    const listed = await listAllSessionsHeaderOnly();
    expect(listed).toHaveLength(1);
    expect(listed[0].firstMessage).toBe("hello");
  });
});

describe("the index survives a process restart", () => {
  it("rebuilds from disk without dropping or duplicating sessions", async () => {
    const { agentDir, dataDir } = sandbox();
    writeSession(agentDir, "a.jsonl", headerLine("a-1"), messageLine("u1", "user", "hello"), sessionInfoLine("si1", "disk name"));
    writeSession(agentDir, "b.jsonl", headerLine("b-1"));
    clearCaches();

    const before = await listAllSessionsHeaderOnly();
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(readFileSync(path.join(dataDir, "session-index.json"), "utf8")).toContain("disk name");

    delete (globalThis as Record<string, unknown>).__piSessionIndex;
    const after = await listAllSessionsHeaderOnly();

    expect(after.map((s) => s.id).sort()).toEqual(before.map((s) => s.id).sort());
    expect(after.find((s) => s.id === "a-1")?.name).toBe("disk name");
    expect(after.find((s) => s.id === "a-1")?.firstMessage).toBe("hello");
  });
});
