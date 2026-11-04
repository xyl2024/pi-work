import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryPanel, openMemory } from "@/lib/client/memory-panel";
import type { MemoryEntriesResponse } from "@/lib/shared/memory";

function library(target: "memory" | "user", text: string) {
  return {
    target,
    file: target === "memory" ? "MEMORY.md" : "USER.md",
    status: "ok" as const,
    entries: [{ index: 0, text, length: text.length, oversized: false, hash: "h" }],
    hash: "hash",
    used: text.length,
    limit: 1000,
  };
}

function entries(text: string): MemoryEntriesResponse {
  return { enabled: true, memory: library("memory", text), user: library("user", text) };
}

function stubEntries() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const cwd = new URL(url, "http://localhost").searchParams.get("cwd") ?? "global";
    return new Response(JSON.stringify(entries(`entry for ${cwd}`)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function entriesCalls(fetchMock: ReturnType<typeof stubEntries>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith("/api/memory/entries"));
}

afterEach(() => {
  memoryPanel.release();
  vi.unstubAllGlobals();
});

describe("memory main view store", () => {
  it("loads the entries once for a cwd, then keeps them", async () => {
    const fetchMock = stubEntries();

    openMemory({ cwd: "/project-a" });
    await vi.waitFor(() => expect(memoryPanel.get().loaded).toBe(true));

    openMemory({ cwd: "/project-a" });

    expect(entriesCalls(fetchMock)).toEqual(["/api/memory/entries?cwd=%2Fproject-a"]);
    expect(memoryPanel.get().response?.memory.entries[0]?.text).toBe("entry for /project-a");
  });

  it("reloads when the working directory changes", async () => {
    const fetchMock = stubEntries();

    openMemory({ cwd: "/project-a" });
    await vi.waitFor(() => expect(memoryPanel.get().loaded).toBe(true));

    openMemory({ cwd: "/project-b" });
    await vi.waitFor(() =>
      expect(memoryPanel.get().response?.memory.entries[0]?.text).toBe("entry for /project-b"),
    );

    expect(entriesCalls(fetchMock)).toEqual([
      "/api/memory/entries?cwd=%2Fproject-a",
      "/api/memory/entries?cwd=%2Fproject-b",
    ]);
  });

  it("shows the load error instead of stale entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })),
    );

    openMemory({ cwd: "/project-a" });
    await vi.waitFor(() => expect(memoryPanel.get().loadError).not.toBeNull());

    expect(memoryPanel.get().response).toBeNull();
  });
});
