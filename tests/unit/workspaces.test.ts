import { describe, expect, it } from "vitest";
import { api, type Json } from "./helpers";

/**
 * /api/workspaces is read-only: it aggregates pi session JSONLs by cwd.
 * The isolated agent dir starts empty, so business assertions focus on
 * response shape, pagination parameters and cursor robustness. Seeding
 * real session JSONLs is planned as part of the sessions-domain batch.
 */
describe("workspaces api", () => {
  it("returns a paged response with the documented shape", async () => {
    const res = await api("/api/workspaces");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.workspaces)).toBe(true);
    // nextCursor: string | null
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

  it("tolerates a garbage cursor without erroring", async () => {
    const res = await api("/api/workspaces?cursor=not-a-valid-cursor");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.workspaces)).toBe(true);
  });
});
