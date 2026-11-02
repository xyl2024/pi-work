import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@/lib/shared/types";
import {
  selectAssistantRestoreSession,
  selectLatestAssistantSession,
} from "@/lib/shared/assistant-session";

function session(id: string, options: { assistant?: boolean; modified?: string } = {}): SessionInfo {
  return {
    path: "",
    id,
    cwd: "/tmp",
    created: options.modified ?? "2026-01-01T00:00:00.000Z",
    modified: options.modified ?? "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "",
    running: false,
    ...(options.assistant === undefined ? {} : { assistant: options.assistant }),
  };
}

describe("selectLatestAssistantSession", () => {
  it("picks the most recently modified assistant session", () => {
    const latest = selectLatestAssistantSession([
      session("old", { assistant: true, modified: "2026-01-01T00:00:00.000Z" }),
      session("new", { assistant: true, modified: "2026-02-01T00:00:00.000Z" }),
      session("middle", { assistant: true, modified: "2026-01-15T00:00:00.000Z" }),
    ]);

    expect(latest?.id).toBe("new");
  });

  it("ignores plain sessions", () => {
    const latest = selectLatestAssistantSession([
      session("plain", { modified: "2026-03-01T00:00:00.000Z" }),
      session("assistant", { assistant: true, modified: "2026-01-01T00:00:00.000Z" }),
    ]);

    expect(latest?.id).toBe("assistant");
  });

  it("returns null when no assistant session exists", () => {
    expect(selectLatestAssistantSession([session("plain")])).toBeNull();
    expect(selectLatestAssistantSession([])).toBeNull();
  });
});

describe("selectAssistantRestoreSession", () => {
  it("restores the latest assistant session on a plain reload", () => {
    const restore = selectAssistantRestoreSession(null, [
      session("old", { assistant: true, modified: "2026-01-01T00:00:00.000Z" }),
      session("new", { assistant: true, modified: "2026-02-01T00:00:00.000Z" }),
    ]);

    expect(restore?.id).toBe("new");
  });

  it("does not replace a session opened through a deep link", () => {
    const restore = selectAssistantRestoreSession("deep-link", [
      session("assistant", { assistant: true, modified: "2026-02-01T00:00:00.000Z" }),
    ]);

    expect(restore).toBeNull();
  });

  it("keeps the plain draft when no assistant session exists", () => {
    expect(selectAssistantRestoreSession(null, [session("plain")])).toBeNull();
    expect(selectAssistantRestoreSession(null, [])).toBeNull();
  });
});
