import { afterEach, describe, expect, it, vi } from "vitest";
import {
  memoryPanel,
  resolveMemoryConflict,
  saveMemoryChanges,
  selectMemoryFile,
} from "@/lib/client/memory-panel";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface RequestLog {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function stubApi(log: RequestLog[], firstWriteStatus: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      log.push({ url, method, body });
      if (url === "/api/memory/files") {
        return jsonResponse(200, { files: [{ file: "notes.md", isIndex: false, mtime: "2026-01-01T00:00:00.000Z", description: "" }] });
      }
      if (url === "/api/memory/file?file=notes.md" && method === "GET") {
        return jsonResponse(200, { content: "打开时的内容", mtime: "2026-01-01T00:00:00.000Z" });
      }
      if (url === "/api/memory/file" && method === "PUT") {
        if (body.force === true) return jsonResponse(200, { mtime: "2026-01-02T00:00:00.000Z" });
        return jsonResponse(firstWriteStatus, {
          error: "Memory file changed on disk",
          content: "agent 改过的新内容",
          mtime: "2026-01-01T12:00:00.000Z",
        });
      }
      return jsonResponse(404, { error: "not found" });
    }),
  );
}

afterEach(() => {
  memoryPanel.release();
  vi.unstubAllGlobals();
});

async function openDetailWithContent(content: string): Promise<void> {
  memoryPanel.open();
  await vi.waitFor(() => expect(memoryPanel.get().loaded).toBe(true));
  selectMemoryFile("notes.md");
  await vi.waitFor(() => expect(memoryPanel.get().detailLoading).toBe(false));
  const { setMemoryContent } = await import("@/lib/client/memory-panel");
  setMemoryContent(content);
}

describe("memory panel save conflict", () => {
  it("surfaces the disk version in the conflict state and keeps my edits", async () => {
    const log: RequestLog[] = [];
    stubApi(log, 409);
    await openDetailWithContent("我的修改");

    await saveMemoryChanges();

    const state = memoryPanel.get();
    expect(state.conflict).toEqual({
      diskContent: "agent 改过的新内容",
      diskMtime: "2026-01-01T12:00:00.000Z",
    });
    expect(state.content).toBe("我的修改");
    expect(state.saveError).toBeNull();
    expect(state.saving).toBe(false);
    expect(log.some((entry) => entry.body.mtime === "2026-01-01T00:00:00.000Z")).toBe(true);
  });

  it("overwrites with force and clears the conflict", async () => {
    const log: RequestLog[] = [];
    stubApi(log, 409);
    await openDetailWithContent("我的修改");
    await saveMemoryChanges();

    resolveMemoryConflict("overwrite");
    await vi.waitFor(() => expect(memoryPanel.get().conflict).toBeNull());

    const state = memoryPanel.get();
    expect(state.baseline).toBe("我的修改");
    expect(state.saving).toBe(false);
    const forcePut = log.find((entry) => entry.body.force === true);
    expect(forcePut?.body.content).toBe("我的修改");
  });

  it("discarding my changes returns to the disk content", async () => {
    const log: RequestLog[] = [];
    stubApi(log, 409);
    await openDetailWithContent("我的修改");
    await saveMemoryChanges();

    resolveMemoryConflict("discard");
    await vi.waitFor(() => expect(memoryPanel.get().conflict).toBeNull());

    const state = memoryPanel.get();
    expect(state.content).toBe("agent 改过的新内容");
    expect(state.baseline).toBe("agent 改过的新内容");
    expect(state.openedMtime).toBe("2026-01-01T12:00:00.000Z");
    expect(state.conflict).toBeNull();
    expect(log.filter((entry) => entry.method === "PUT")).toHaveLength(1);
  });
});
