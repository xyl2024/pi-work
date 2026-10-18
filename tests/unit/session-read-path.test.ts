// Opening a session must not depend on a scan of every session on disk.
//
// `SessionManager.listAll()` (pi) reads every session JSONL to EOF to compute
// fields nobody needs on this path; on a host with thousands of sessions that
// is a ~5s stall per open, which is why `readSessionDetails` had to stop
// calling it. Two rules are pinned here:
//
//   1. the parent session id comes from the parent file's own header (a single
//      bounded 16KB read), not from a global listing;
//   2. resolving a session id → path goes through the bounded header scan, so
//      a cold server boot does not pay the full scan either.
//
// `readSessionDetails`'s own dependency on `listAllSessions` is guarded at the
// source level: it is a pure I/O decision, and asserting it from the outside
// would mean timing a multi-second scan.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveParentSessionId, resolveSessionPath } from "@/lib/server/sessions/reader";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

const READER = "lib/server/sessions/reader.ts";

/** Body of a top-level `export async function ...` (up to its closing brace). */
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

/** Temp agent dir + Pi Work data dir; never the real ~/.pi or ~/.pi-work. */
function sandbox(): { agentDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "pi-work-session-read-"));
  created.push(root);
  const agentDir = path.join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = path.join(root, "data");
  return { agentDir };
}

/** First line of a session file, same shape pi writes. */
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

/** Module-level caches live on globalThis (hot-reload safe), so tests share them. */
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
    // No session header → no id to report; the full-scan path behaved the same.
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
    // The full listing reads every JSONL to EOF; it was only here for this field.
    expect(body).not.toContain("listAllSessions(");
    expect(body).toContain("resolveParentSessionId(");
  });

  it("tries the header-only listing before the full scan", () => {
    const body = functionSource(READER, "export async function resolveSessionPath");
    expect(body).toContain("listAllSessionsHeaderOnly()");
    expect(body.indexOf("listAllSessionsHeaderOnly()")).toBeLessThan(body.indexOf("listAllSessions()"));
  });
});
