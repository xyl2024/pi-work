import { describe, expect, it } from "vitest";
import { TEST_BASE_URL } from "../config";
import { authedInit } from "./helpers";

describe("api smoke", () => {
  it("GET /api/models returns a JSON payload", async () => {
    const res = await fetch(`${TEST_BASE_URL}/api/models`, await authedInit());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = (await res.json()) as { models?: unknown };
    expect(data).toBeTypeOf("object");
  });

  it("GET / serves the app shell", async () => {
    const res = await fetch(TEST_BASE_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<html");
  });
});
