/**
 * Shared helpers for interface (unit-layer) tests.
 *
 * Tests run against the isolated instance booted in tests/global-setup.ts.
 * Data policy (see tests/README.md): every test creates its own uniquely
 * identified data and cleans it up — tests never depend on each other's
 * leftovers.
 */
import { TEST_BASE_URL } from "../config";

export type Json = Record<string, unknown>;

/** Fetch an API path, returning the parsed JSON body regardless of status. */
export async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Json; res: Response }> {
  const res = await fetch(`${TEST_BASE_URL}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, body, res };
}

/** Unique per-run suffix so concurrent runs / reruns never collide. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** expect(status).toBe(200)-style helper with a readable failure message. */
export function expectOk(status: number, body: Json): void {
  if (status !== 200) {
    throw new Error(`expected 200, got ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
