import { describe, expect, it } from "vitest";
import {
  hasDirtyMcpBucket,
  isMcpBucketVerifying,
  MCP_LIST_PAGE,
  releaseMcpBuckets,
  selectMcpBucket,
  shouldApplyMcpSnapshot,
  withMcpBucket,
  withMcpBucketVerified,
  type McpDraftBucket,
  type McpDraftBuckets,
} from "@/lib/shared/mcp-drafts";
import { draftFromPanelData } from "@/lib/shared/mcp-draft";
import type { McpPanelData } from "@/lib/shared/mcp-panel";

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

describe("restore", () => {
  it("returns the parked bucket untouched when the cwd comes back", () => {
    const state = bucketsOf(bucket("/a", true), bucket("/b", false));
    expect(selectMcpBucket(state, "/a")).toEqual(bucket("/a", true));
    expect(selectMcpBucket(state, "/b")).toEqual(bucket("/b", false));
  });

  it("keeps each cwd's page stack with its own bucket", () => {
    const onEntry = {
      ...bucket("/a", false),
      pages: [MCP_LIST_PAGE, { kind: "entry" as const, uid: "a:server:0" }],
    };
    const state = bucketsOf(onEntry, bucket("/b", false));

    expect(selectMcpBucket(state, "/a")?.pages).toEqual([
      MCP_LIST_PAGE,
      { kind: "entry", uid: "a:server:0" },
    ]);
    expect(selectMcpBucket(state, "/b")?.pages).toEqual([MCP_LIST_PAGE]);
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
