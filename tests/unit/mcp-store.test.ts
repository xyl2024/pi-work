import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_LIST_PAGE } from "@/lib/shared/mcp-drafts";
import type { McpPage, McpPanelData } from "@/lib/shared/mcp-panel";
import { mcpPanel, openMcpEntry, setMcpEntryName } from "@/lib/client/mcp-panel";

const mocks = vi.hoisted(() => ({
  fetchMcpPanelData: vi.fn<(cwd: string, signal?: AbortSignal) => Promise<McpPanelData>>(),
}));

vi.mock("@/lib/client/mcp-io", () => ({
  fetchMcpPanelData: mocks.fetchMcpPanelData,
  putMcpPanelChanges: vi.fn(),
}));

function data(name: string): McpPanelData {
  return {
    files: [],
    entries: [
      {
        name,
        scope: "global",
        rawJson: JSON.stringify({ command: name }),
        error: null,
        shadowsGlobal: false,
        shadowedByProject: false,
        override: false,
      },
    ],
    projectTrusted: true,
    errors: [],
  };
}

function entry(uid: string): McpPage {
  return { kind: "entry", uid };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  mcpPanel.release();
  mocks.fetchMcpPanelData.mockReset();
});

describe("mcp page stacks per bucket", () => {
  it("writes page changes back to the active bucket and reads the bucket's stack when the cwd returns", async () => {
    mocks.fetchMcpPanelData.mockImplementation((cwd) => Promise.resolve(data(cwd.slice(1))));

    mcpPanel.open("/a");
    await vi.waitFor(() => expect(mcpPanel.get().buckets["/a"]).toBeDefined());

    openMcpEntry("global:a:0");
    expect(mcpPanel.currentPage()).toEqual(entry("global:a:0"));
    expect(mcpPanel.get().buckets["/a"]?.pages).toEqual([MCP_LIST_PAGE, entry("global:a:0")]);

    mcpPanel.open("/b");
    await vi.waitFor(() => expect(mcpPanel.get().buckets["/b"]).toBeDefined());
    expect(mcpPanel.currentPage()).toEqual(MCP_LIST_PAGE);

    openMcpEntry("global:b:0");
    expect(mcpPanel.get().buckets["/b"]?.pages).toEqual([MCP_LIST_PAGE, entry("global:b:0")]);

    mcpPanel.open("/a");
    await vi.waitFor(() => expect(mcpPanel.get().currentCwd).toBe("/a"));
    expect(mcpPanel.currentPage()).toEqual(entry("global:a:0"));
    expect(mcpPanel.get().buckets["/a"]?.pages).toEqual([MCP_LIST_PAGE, entry("global:a:0")]);
    expect(mcpPanel.get().buckets["/b"]?.pages).toEqual([MCP_LIST_PAGE, entry("global:b:0")]);
  });

  it("keeps a dirty bucket's draft and page stack when the cwd comes back", async () => {
    mocks.fetchMcpPanelData.mockImplementation((cwd) => Promise.resolve(data(cwd.slice(1))));

    mcpPanel.open("/a");
    await vi.waitFor(() => expect(mcpPanel.get().buckets["/a"]).toBeDefined());
    openMcpEntry("global:a:0");
    setMcpEntryName("global:a:0", "edited");

    mcpPanel.open("/b");
    await vi.waitFor(() => expect(mcpPanel.get().buckets["/b"]).toBeDefined());

    mcpPanel.open("/a");
    await settle();

    expect(mocks.fetchMcpPanelData.mock.calls.filter(([cwd]) => cwd === "/a")).toHaveLength(1);
    expect(mcpPanel.get().buckets["/a"]?.dirty).toBe(true);
    expect(mcpPanel.get().buckets["/a"]?.draft.entries[0].name).toBe("edited");
    expect(mcpPanel.currentPage()).toEqual(entry("global:a:0"));
  });
});

describe("mcp release", () => {
  it("drops the in-flight snapshot and reads the new disk state after reopening", async () => {
    let resolveFirst: ((value: McpPanelData) => void) | null = null;
    mocks.fetchMcpPanelData.mockImplementationOnce(
      () =>
        new Promise<McpPanelData>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    mcpPanel.open("/a");
    expect(resolveFirst).not.toBeNull();
    mcpPanel.release();
    resolveFirst!(data("old"));
    await settle();
    expect(mcpPanel.get().buckets["/a"]).toBeUndefined();

    mocks.fetchMcpPanelData.mockImplementationOnce(() => Promise.resolve(data("fresh")));
    mcpPanel.open("/a");
    await vi.waitFor(() => expect(mcpPanel.get().buckets["/a"]).toBeDefined());
    expect(mcpPanel.get().buckets["/a"]?.draft.entries[0].name).toBe("fresh");
  });
});
