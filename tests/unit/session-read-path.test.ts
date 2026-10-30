import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  listAllSessionsHeaderOnly,
  readSessionDetails,
  resolveParentSessionId,
  resolveSessionPath,
} from "@/lib/server/sessions/reader";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

const READER = "lib/server/sessions/reader.ts";

function functionSource(file: string, marker: string): string {
  const source = read(file);
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`no ${marker} in ${file}`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end === -1 ? undefined : end);
}

const created: string[] = [];
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const savedDataDir = process.env.PI_WORK_DATA_DIR;

function sandbox(): { agentDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "pi-work-session-read-"));
  created.push(root);
  const agentDir = path.join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = path.join(root, "data");
  return { agentDir };
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

function writeSession(agentDir: string, fileName: string, header: string, ...lines: string[]): string {
  const dir = path.join(agentDir, "sessions", "--tmp-project--");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, [header, ...lines].join(""), "utf8");
  return filePath;
}

function clearCaches(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSessionPathCache;
  delete g.__piSessionListCache;
  delete g.__piSessionListHeaderCache;
  delete g.__piSessionListInflight;
  delete g.__piSessionListHeaderInflight;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  if (savedDataDir === undefined) delete process.env.PI_WORK_DATA_DIR;
  else process.env.PI_WORK_DATA_DIR = savedDataDir;
  clearCaches();
});

describe("resolveParentSessionId", () => {
  it("maps the header's parentSession path to the parent's own id", () => {
    const { agentDir } = sandbox();
    const parentPath = writeSession(agentDir, "parent.jsonl", headerLine("parent-1"));
    writeSession(agentDir, "child.jsonl", headerLine("child-1", { parentSession: parentPath }));

    expect(resolveParentSessionId(parentPath)).toBe("parent-1");
  });

  it("answers undefined for no parent, a missing parent, and an unreadable one", () => {
    const { agentDir } = sandbox();
    const missing = path.join(agentDir, "sessions", "--tmp-project--", "gone.jsonl");
    const empty = writeSession(agentDir, "empty.jsonl", "");

    expect(resolveParentSessionId(undefined)).toBeUndefined();
    expect(resolveParentSessionId(missing)).toBeUndefined();
    expect(resolveParentSessionId(empty)).toBeUndefined();
  });
});

describe("resolveSessionPath", () => {
  it("resolves an id from the bounded header scan", async () => {
    const { agentDir } = sandbox();
    const filePath = writeSession(agentDir, "solo.jsonl", headerLine("solo-1"));
    clearCaches();

    await expect(resolveSessionPath("solo-1")).resolves.toBe(filePath);
  });

  it("returns null for an unknown id instead of guessing a path", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "solo.jsonl", headerLine("solo-1"));
    clearCaches();

    await expect(resolveSessionPath("nope")).resolves.toBeNull();
  });
});

describe("readSessionDetails: no global session scan", () => {
  it("resolves the parent id without listAllSessions", () => {
    const body = functionSource(READER, "export async function readSessionDetails");
    expect(body).not.toContain("listAllSessions(");
    expect(body).toContain("resolveParentSessionId(");
  });

  it("tries the header-only listing before the full scan", () => {
    const body = functionSource(READER, "export async function resolveSessionPath");
    expect(body).toContain("listAllSessionsHeaderOnly()");
    expect(body.indexOf("listAllSessionsHeaderOnly()")).toBeLessThan(body.indexOf("listAllSessions()"));
  });
});

describe("firstMessage never carries pi's placeholder", () => {
  const imageOnlyMessage = JSON.stringify({
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: "2026-01-02T03:04:06.000Z",
    message: {
      role: "user",
      timestamp: 1,
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    },
  }) + "\n";

  it("header-only listing reports \"\" for an image-only first turn and for an empty file", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "image.jsonl", headerLine("image-1"), imageOnlyMessage);
    writeSession(agentDir, "header.jsonl", headerLine("header-1"));
    clearCaches();

    const rows = await listAllSessionsHeaderOnly();
    const byId = new Map(rows.map((r) => [r.id, r.firstMessage]));

    expect(byId.get("image-1")).toBe("");
    expect(byId.get("header-1")).toBe("");
  });

  it("readSessionDetails reports \"\" for an image-only first turn", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "image.jsonl", headerLine("image-2"), imageOnlyMessage);
    clearCaches();

    const details = await readSessionDetails("image-2");
    expect(details?.info?.firstMessage).toBe("");
  });
});

describe("the first user message is found past a huge system-prompt entry", () => {
  it("keeps scanning past an entry larger than one chunk", async () => {
    const { agentDir } = sandbox();
    const systemEntry = JSON.stringify({
      type: "message",
      id: "s1",
      parentId: null,
      timestamp: "2026-01-02T03:04:06.000Z",
      message: {
        role: "system",
        content: "",
        sections: [{ title: "identity", body: "y".repeat(40 * 1024) }],
        timestamp: 1,
      },
    }) + "\n";
    const userEntry = JSON.stringify({
      type: "message",
      id: "u1",
      parentId: "s1",
      timestamp: "2026-01-02T03:04:07.000Z",
      message: { role: "user", timestamp: 2, content: [{ type: "text", text: "move the language switch" }] },
    }) + "\n";
    writeSession(agentDir, "deep.jsonl", headerLine("deep-1"), systemEntry, userEntry);
    clearCaches();

    const rows = await listAllSessionsHeaderOnly();
    expect(rows.find((r) => r.id === "deep-1")?.firstMessage).toBe("move the language switch");
  });
});
