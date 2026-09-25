/**
 * The desktop track's session signer and the three auth-session endpoints that
 * mint, clear and report it. Driven directly through the modules (no HTTP
 * instance): the isolated instance the interface tests use always runs on the
 * server track, and this is the one place that has to be told otherwise.
 *
 * Every test sets/restores its own PI_WORK_* environment — the modules read
 * process.env at call time.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as statusRoute } from "@/app/api/auth/session/status/route";
import { POST as loginRoute } from "@/app/api/auth/session/login/route";
import { POST as logoutRoute } from "@/app/api/auth/session/logout/route";
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  isLoginEnabled,
  isUsingDefaultCredentials,
  verifySessionToken,
} from "@/lib/server/auth";

const TRACKED_ENV = [
  "PI_WORK_DESKTOP",
  "PI_WORK_DESKTOP_SECRET",
  "PI_WORK_AUTH_USERNAME",
  "PI_WORK_AUTH_PASSWORD",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const name of TRACKED_ENV) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of TRACKED_ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

function enterDesktopMode(secret?: string) {
  process.env.PI_WORK_DESKTOP = "1";
  if (secret !== undefined) process.env.PI_WORK_DESKTOP_SECRET = secret;
}

function loginRequest(body: unknown): Request {
  return new Request("http://localhost:30143/api/auth/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function statusRequest(cookie?: string): Request {
  return new Request("http://localhost:30143/api/auth/session/status", {
    headers: cookie ? { cookie: `${AUTH_COOKIE_NAME}=${cookie}` } : undefined,
  });
}

describe("server track (PI_WORK_AUTH_*)", () => {
  it("signs and verifies a session with the credentials", () => {
    expect(isLoginEnabled()).toBe(true);
    expect(verifySessionToken(createSessionToken())).toBe(true);
  });

  it("rejects a token signed by other credentials", () => {
    const token = createSessionToken();
    process.env.PI_WORK_AUTH_PASSWORD = "changed";

    expect(verifySessionToken(token)).toBe(false);
  });
});

describe("desktop track (PI_WORK_DESKTOP)", () => {
  it("signs and verifies a session with the shell's per-launch secret", () => {
    enterDesktopMode("launch-1");

    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
    expect(isLoginEnabled()).toBe(false);
    expect(isUsingDefaultCredentials()).toBe(false);
  });

  it("invalidates every cookie the previous launch signed", () => {
    enterDesktopMode("launch-1");
    const token = createSessionToken();

    enterDesktopMode("launch-2");
    expect(verifySessionToken(token)).toBe(false);
    expect(verifySessionToken(createSessionToken())).toBe(true);
  });

  it("does not accept a token signed by the credential pair", () => {
    const serverToken = createSessionToken();

    enterDesktopMode("launch-1");
    expect(verifySessionToken(serverToken)).toBe(false);
  });

  it("trusts nothing when the shell passed no secret", () => {
    enterDesktopMode();

    expect(isLoginEnabled()).toBe(false);
    expect(() => createSessionToken()).toThrow(/PI_WORK_DESKTOP_SECRET/);
    expect(verifySessionToken("9999999999999.deadbeef")).toBe(false);
  });
});

describe("auth session endpoints", () => {
  it("logs in with credentials on the server track", async () => {
    const res = await loginRoute(loginRequest({ username: "admin", password: "admin" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${AUTH_COOKIE_NAME}=`);
  });

  it("refuses to log in on the desktop track", async () => {
    enterDesktopMode("launch-1");

    const res = await loginRoute(loginRequest({ username: "admin", password: "admin" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses to log out on the desktop track (the shell owns the cookie)", async () => {
    enterDesktopMode("launch-1");

    const res = await logoutRoute();
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("clears the cookies on the server track", async () => {
    const res = await logoutRoute();

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("reports the track it is on", async () => {
    const server = await (await statusRoute(statusRequest())).json();
    expect(server).toMatchObject({ authenticated: false, desktop: false });

    enterDesktopMode("launch-1");
    const desktop = await (await statusRoute(statusRequest())).json();
    expect(desktop).toMatchObject({ authenticated: false, desktop: true });

    const authed = await (await statusRoute(statusRequest(createSessionToken()))).json();
    expect(authed).toMatchObject({ authenticated: true, desktop: true });
  });
});
