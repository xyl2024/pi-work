import { describe, expect, it } from "vitest";
import {
  hasDirtyMcpBucket,
  isMcpBucketVerifying,
  parkMcpBucket,
  releaseMcpBuckets,
  selectMcpBucket,
  shouldApplyMcpSnapshot,
  withMcpBucket,
  withMcpBucketVerified,
  type McpDraftBucket,
  type McpDraftBuckets,
} from "@/lib/shared/mcp-drafts";
import { MCP_LIST_PAGE } from "@/lib/shared/mcp-pages";
import { draftFromPanelData } from "@/lib/shared/mcp-draft";
import type { McpPanelData } from "@/lib/shared/mcp-panel";

/**
 * The MCP panel's per-cwd draft buckets (lib/shared/mcp-drafts.ts): leaving a
 * cwd keeps its bucket, a return shows the snapshot, and the shared "any cwd
 * dirty" predicate drives both the badge and the close guard. Plain data — no
 * React, no DOM, no server.
 */

const DATA: McpPanelData = {
  files: [],
  entries: [],
  errors: [],
  projectTrusted: true,
};

function bucket(cwd: string, dirty: boolean, verified = true): McpDraftBucket {
  return { cwd, data: DATA, draft: draftFromPanelData(DATA), pages: [MCP_LIST_PAGE], dirty, verified };
}

function bucketsOf(...items: McpDraftBucket[]): McpDraftBuckets {
  return items.reduce<McpDraftBuckets>((acc, item) => withMcpBucket(acc, item), {});
}

describe("parkMcpBucket", () => {
  it("keeps a dirty bucket for the cwd it left", () => {
    const state = bucketsOf(bucket("/a", true), bucket("/b", true));
    expect(parkMcpBucket(state, "/b")).toEqual(state);
  });

  it("keeps a clean bucket too — it is the snapshot the next visit shows", () => {
    const state = bucketsOf(bucket("/a", true), bucket("/b", false));
    const parked = parkMcpBucket(state, "/b");
    expect(selectMcpBucket(parked, "/b")).toEqual(bucket("/b", false));
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

describe("background reconcile facts", () => {
  it("shows the checking indicator only while a snapshot is unverified", () => {
    expect(isMcpBucketVerifying(null)).toBe(false);
    expect(isMcpBucketVerifying(bucket("/a", false))).toBe(false);
    expect(isMcpBucketVerifying(bucket("/a", false, false))).toBe(true);
  });

  it("lets a fresh snapshot land unless the draft is dirty", () => {
    expect(shouldApplyMcpSnapshot(null)).toBe(true);
    expect(shouldApplyMcpSnapshot(bucket("/a", false))).toBe(true);
    expect(shouldApplyMcpSnapshot(bucket("/a", true))).toBe(false);
  });

  it("marks a bucket verified without touching a missing one", () => {
    const state = withMcpBucketVerified(bucketsOf(bucket("/a", false, false)), "/a", true);
    expect(selectMcpBucket(state, "/a")?.verified).toBe(true);
    expect(withMcpBucketVerified(state, "/missing", true)).toBe(state);
  });
});
