import { describe, expect, it } from "vitest";
import {
  hasDirtyMcpBucket,
  parkMcpBucket,
  releaseMcpBuckets,
  selectMcpBucket,
  withMcpBucket,
  type McpDraftBucket,
  type McpDraftBuckets,
} from "@/lib/shared/mcp-drafts";
import { MCP_LIST_PAGE } from "@/lib/shared/mcp-pages";
import { draftFromPanelData } from "@/lib/shared/mcp-draft";
import type { McpPanelData } from "@/lib/shared/mcp-panel";

/**
 * The MCP panel's per-cwd draft buckets (lib/shared/mcp-drafts.ts): park only
 * keeps dirty drafts, a return to the cwd restores the parked draft, and the
 * shared "any cwd dirty" predicate drives both the badge and the close guard.
 * Plain data — no React, no DOM, no server.
 */

const DATA: McpPanelData = {
  files: [],
  entries: [],
  errors: [],
  projectTrusted: true,
};

function bucket(cwd: string, dirty: boolean): McpDraftBucket {
  return { cwd, data: DATA, draft: draftFromPanelData(DATA), pages: [MCP_LIST_PAGE], dirty };
}

function bucketsOf(...items: McpDraftBucket[]): McpDraftBuckets {
  return items.reduce<McpDraftBuckets>((acc, item) => withMcpBucket(acc, item), {});
}

describe("parkMcpBucket", () => {
  it("keeps a dirty bucket for the cwd it left", () => {
    const state = bucketsOf(bucket("/a", true), bucket("/b", true));
    expect(parkMcpBucket(state, "/b")).toEqual(state);
  });

  it("drops a clean bucket — there is nothing to restore", () => {
    const state = bucketsOf(bucket("/a", true), bucket("/b", false));
    const parked = parkMcpBucket(state, "/b");
    expect(selectMcpBucket(parked, "/b")).toBeNull();
    expect(selectMcpBucket(parked, "/a")).toEqual(bucket("/a", true));
  });

  it("is a no-op when there is no bucket for the cwd or no cwd at all", () => {
    const state = bucketsOf(bucket("/a", true));
    expect(parkMcpBucket(state, "/missing")).toBe(state);
    expect(parkMcpBucket(state, null)).toBe(state);
  });
});

describe("restore", () => {
  it("returns the parked draft untouched when the cwd comes back", () => {
    const parked = parkMcpBucket(bucketsOf(bucket("/a", true), bucket("/b", false)), "/b");
    expect(selectMcpBucket(parked, "/a")).toEqual(bucket("/a", true));
  });
});

describe("hasDirtyMcpBucket", () => {
  it("is false with no buckets or only clean ones", () => {
    expect(hasDirtyMcpBucket({})).toBe(false);
    expect(hasDirtyMcpBucket(bucketsOf(bucket("/a", false)))).toBe(false);
  });

  it("is true when any cwd has a dirty draft", () => {
    expect(hasDirtyMcpBucket(bucketsOf(bucket("/a", false), bucket("/b", true)))).toBe(true);
  });
});

describe("releaseMcpBuckets", () => {
  it("drops every bucket, including dirty ones", () => {
    const released = releaseMcpBuckets();
    expect(selectMcpBucket(released, "/a")).toBeNull();
    expect(hasDirtyMcpBucket(released)).toBe(false);
  });
});
