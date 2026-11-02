import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ASSISTANT_SESSION_ENTRY_TYPE, buildAssistantSessionMarkerData } from "@/lib/shared/assistant-marker";
import { readSessionHeader } from "@/lib/server/sessions/reader";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeSession(lines: unknown[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "pi-work-assistant-header-"));
  created.push(root);
  const dir = path.join(root, "sessions", "--tmp-project--");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "s.jsonl");
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  return filePath;
}

function header(): unknown {
  return {
    type: "session",
    version: 3,
    id: "s-1",
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/tmp/project",
  };
}

function marker(data: unknown): unknown {
  return {
    type: "custom",
    id: "c-1",
    parentId: "h-1",
    timestamp: "2026-01-02T03:04:06.000Z",
    customType: ASSISTANT_SESSION_ENTRY_TYPE,
    data,
  };
}

function user(text: string): unknown {
  return {
    type: "message",
    id: "u-1",
    parentId: "c-1",
    timestamp: "2026-01-02T03:04:07.000Z",
    message: { role: "user", content: [{ type: "text", text }], timestamp: 1700000000000 },
  };
}

describe("readSessionHeader assistant marker", () => {
  it("marks a session whose file carries the assistant marker", () => {
    const filePath = writeSession([header(), marker(buildAssistantSessionMarkerData()), user("你好")]);

    expect(readSessionHeader(filePath)?.assistant).toBe(true);
  });

  it("leaves plain pi sessions unmarked", () => {
    const filePath = writeSession([header(), user("你好")]);

    expect(readSessionHeader(filePath)?.assistant).toBeUndefined();
  });

  it("ignores custom entries with malformed marker data", () => {
    const filePath = writeSession([header(), marker({ version: 99 }), user("你好")]);

    expect(readSessionHeader(filePath)?.assistant).toBeUndefined();
  });
});
