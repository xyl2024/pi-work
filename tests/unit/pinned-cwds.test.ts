import { afterAll, describe, expect, it } from "vitest";
import { api, uniqueId } from "./helpers";

/**
 * /api/pinned-cwds is a whole-array string list (PUT replaces everything).
 * Policy: snapshot the original value, write test data, verify, restore.
 */
let original: string[] | undefined;

afterAll(async () => {
  if (original) {
    await api("/api/pinned-cwds", {
      method: "PUT",
      body: JSON.stringify({ cwds: original }),
    });
  }
});

describe("pinned-cwds api", () => {
  it("reads, replaces, verifies, and restores the list", async () => {
    const before = await api("/api/pinned-cwds");
    expect(before.status).toBe(200);
    expect(Array.isArray(before.body.cwds)).toBe(true);
    original = before.body.cwds as string[];

    const mine = [`/tmp/${uniqueId("cwd-a")}`, `/tmp/${uniqueId("cwd-b")}`];
    const put = await api("/api/pinned-cwds", {
      method: "PUT",
      body: JSON.stringify({ cwds: mine }),
    });
    expect(put.status).toBe(200);

    const after = await api("/api/pinned-cwds");
    expect(after.status).toBe(200);
    expect(after.body.cwds).toEqual(mine);
  });

  it("rejects a non-string-array body with 400", async () => {
    const bad = await api("/api/pinned-cwds", {
      method: "PUT",
      body: JSON.stringify({ cwds: "not-an-array" }),
    });
    expect(bad.status).toBe(400);
  });
});
