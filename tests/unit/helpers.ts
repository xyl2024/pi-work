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

// ── Auth ──────────────────────────────────────────────────────────
// The web UI requires a session cookie (admin/admin by default). Login once
// per process and reuse the Set-Cookie on every subsequent request.
let authCookie: string | null = null;

/** Login to the isolated instance (once) and return the auth cookie value. */
export async function getAuthCookie(): Promise<string> {
  if (authCookie) return authCookie;
  const res = await fetch(`${TEST_BASE_URL}/api/auth/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  if (res.status !== 200) {
    throw new Error(`test login failed with HTTP ${res.status}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const start = setCookie.indexOf("=");
  authCookie = start === -1 ? "" : setCookie.slice(start + 1, setCookie.indexOf(";") === -1 ? undefined : setCookie.indexOf(";"));
  if (!authCookie) throw new Error("test login did not set a cookie");
  return authCookie;
}

/** RequestInit with the auth cookie attached; spread before custom headers. */
export async function authedInit(init?: RequestInit): Promise<RequestInit> {
  return {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), cookie: `pi-work-auth=${await getAuthCookie()}` },
  };
}

/** Fetch an API path, returning the parsed JSON body regardless of status. */
export async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Json; res: Response }> {
  const { headers, ...rest } = await authedInit(init);
  const res = await fetch(`${TEST_BASE_URL}${path}`,
    {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(headers as Record<string, string>),
        ...(init?.headers as Record<string, string> | undefined),
      },
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
