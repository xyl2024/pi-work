import { describe, expect, it } from "vitest";
import { api, type Json } from "./helpers";

describe("workspaces api", () => {
  it("returns a paged response with the documented shape", async () => {
    const res = await api("/api/workspaces");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.workspaces)).toBe(true);
    expect(["string", "object"]).toContain(typeof res.body.nextCursor);

    for (const ws of res.body.workspaces as Json[]) {
      expect(ws.cwd).toBeTypeOf("string");
      expect(ws.lastUsed).toBeTypeOf("string");
      expect(ws.totalSessions).toBeTypeOf("number");
      expect(ws.runningCount).toBeTypeOf("number");
    }
  });

  it("honors the limit parameter", async () => {
    const res = await api("/api/workspaces?limit=1");
    expect(res.status).toBe(200);
    expect((res.body.workspaces as Json[]).length).toBeLessThanOrEqual(1);
  });

  it("pages through every workspace with any limit, ending at a null cursor", async () => {
    const limit = 2;
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const query = `/api/workspaces?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await api(query);
      expect(res.status).toBe(200);
      const rows = res.body.workspaces as Json[];
      expect(rows.length).toBeLessThanOrEqual(limit);
      for (const ws of rows) {
        const cwd = ws.cwd as string;
        expect(seen.has(cwd)).toBe(false);
        seen.add(cwd);
      }
      pages += 1;
      const next = res.body.nextCursor;
      if (next === null) break;
      expect(next).toBeTypeOf("string");
      expect(next).not.toBe(cursor);
      cursor = next as string;
      expect(pages).toBeLessThan(100);
    }
  });

  it("tolerates a garbage cursor without erroring", async () => {
    const res = await api("/api/workspaces?cursor=not-a-valid-cursor");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.workspaces)).toBe(true);
  });
});
