import { afterAll, describe, expect, it } from "vitest";
import { api, uniqueId } from "./helpers";

/**
 * /api/favorites is a whole-array string list (PUT replaces everything).
 * Policy: snapshot the original value, write test data, verify, restore.
 */
let original: string[] | undefined;

async function snapshot(): Promise<void> {
  const res = await api("/api/favorites");
  if (res.status === 200) original = res.body.sessionIds as string[];
}

afterAll(async () => {
  if (original) {
    await api("/api/favorites", {
      method: "PUT",
      body: JSON.stringify({ sessionIds: original }),
    });
  }
});

describe("favorites api", () => {
  it("reads, replaces, verifies, and restores the list", async () => {
    await snapshot();

    const before = await api("/api/favorites");
    expect(before.status).toBe(200);
    expect(Array.isArray(before.body.sessionIds)).toBe(true);

    const mine = [uniqueId("fav-a"), uniqueId("fav-b")];
    const put = await api("/api/favorites", {
      method: "PUT",
      body: JSON.stringify({ sessionIds: mine }),
    });
    expect(put.status).toBe(200);

    const after = await api("/api/favorites");
    expect(after.status).toBe(200);
    expect(after.body.sessionIds).toEqual(mine);
  });

  it("rejects a non-string-array body with 400", async () => {
    const bad = await api("/api/favorites", {
      method: "PUT",
      body: JSON.stringify({ sessionIds: [1, 2, 3] }),
    });
    expect(bad.status).toBe(400);

    const missing = await api("/api/favorites", {
      method: "PUT",
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
  });
});
