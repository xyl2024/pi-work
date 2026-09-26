import { describe, expect, it } from "vitest";
import { api, type Json } from "./helpers";

/**
 * GET /api/sessions accepts an optional `modifiedSince` epoch-ms lower bound,
 * used by the sidebar's "Today's sessions" view to avoid shipping every
 * session to the browser. It filters without changing the response shape, is
 * inclusive at the boundary, and tolerates garbage input by ignoring it.
 *
 * The isolated agent dir may be empty, so these assertions are invariants that
 * hold for any dataset; the filter's exact boundary semantics live in
 * session-today.test.ts.
 */
describe("sessions api modifiedSince", () => {
  it("returns an empty list when the boundary is in the future", async () => {
    const res = await api(`/api/sessions?modifiedSince=${Date.now() + 86_400_000}`);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([]);
  });

  it("returns the full list when the boundary is epoch 0", async () => {
    const all = await api("/api/sessions");
    const sinceZero = await api("/api/sessions?modifiedSince=0");
    expect(sinceZero.status).toBe(200);
    expect((sinceZero.body.sessions as Json[]).length).toBe((all.body.sessions as Json[]).length);
  });

  it("never returns more rows than the unfiltered list", async () => {
    const all = await api("/api/sessions");
    const today = await api(`/api/sessions?modifiedSince=${Date.now()}`);
    expect(today.status).toBe(200);
    expect((today.body.sessions as Json[]).length).toBeLessThanOrEqual((all.body.sessions as Json[]).length);
  });

  it("ignores an unparseable boundary (falls back to the unfiltered list)", async () => {
    const all = await api("/api/sessions");
    const bogus = await api("/api/sessions?modifiedSince=not-a-number");
    expect(bogus.status).toBe(200);
    expect((bogus.body.sessions as Json[]).length).toBe((all.body.sessions as Json[]).length);
  });

  it("keeps the documented response shape when filtering", async () => {
    const res = await api("/api/sessions?modifiedSince=0");
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(Array.isArray(res.body.recentCwds)).toBe(true);
    for (const s of res.body.sessions as Json[]) {
      expect(s.id).toBeTypeOf("string");
      expect(s.cwd).toBeTypeOf("string");
      expect(s.modified).toBeTypeOf("string");
    }
  });
});
