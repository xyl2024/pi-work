import { describe, expect, it } from "vitest";
import { TEST_BASE_URL } from "../config";

/**
 * Smoke example for the interface test layer.
 *
 * These tests run against the isolated instance booted in
 * tests/global-setup.ts — a real HTTP server with a throwaway data root.
 * Copy this file's shape for new API tests.
 */
describe("api smoke", () => {
  it("GET /api/models returns a JSON payload", async () => {
    const res = await fetch(`${TEST_BASE_URL}/api/models`);
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
