import type { McpDraft } from "./mcp-draft";
import type { McpPage, McpPanelData } from "./mcp-panel";

export const MCP_LIST_PAGE: McpPage = { kind: "list" };

export interface McpDraftBucket {
  cwd: string;
  data: McpPanelData;
  draft: McpDraft;
  pages: McpPage[];
  dirty: boolean;
  verified: boolean;
}

export type McpDraftBuckets = Readonly<Record<string, McpDraftBucket>>;

export function withMcpBucket(
  buckets: McpDraftBuckets,
  bucket: McpDraftBucket,
): McpDraftBuckets {
  return { ...buckets, [bucket.cwd]: bucket };
}

export function releaseMcpBuckets(): McpDraftBuckets {
  return {};
}

export function hasDirtyMcpBucket(buckets: McpDraftBuckets): boolean {
  return Object.values(buckets).some((bucket) => bucket.dirty);
}

export function selectMcpBucket(
  buckets: McpDraftBuckets,
  cwd: string | null,
): McpDraftBucket | null {
  return cwd === null ? null : buckets[cwd] ?? null;
}

export function isMcpBucketVerifying(bucket: McpDraftBucket | null): boolean {
  return bucket !== null && !bucket.verified;
}

export function shouldApplyMcpSnapshot(bucket: McpDraftBucket | null): boolean {
  return bucket === null || !bucket.dirty;
}

export function withMcpBucketVerified(
  buckets: McpDraftBuckets,
  cwd: string,
  verified: boolean,
): McpDraftBuckets {
  const bucket = buckets[cwd];
  if (!bucket || bucket.verified === verified) return buckets;
  return withMcpBucket(buckets, { ...bucket, verified });
}
