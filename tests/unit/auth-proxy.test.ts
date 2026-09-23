/**
 * The auth gateway itself (proxy.ts), driven directly with NextRequest — the
 * only way to observe the desktop track without running the shell: the
 * isolated instance the interface tests hit always runs on the server track.
 *
 * What the acceptance asks of the gateway is exactly this: /api without a
 * credential → 401, with the shell's cookie → through, and /login never
 * renders a login flow in desktop mode.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import authProxy from "@/proxy";
import { AUTH_COOKIE_NAME, createSessionToken } from "@/lib/server/auth";

const TRACKED_ENV = ["PI_WORK_DESKTOP", "PI_WORK_DESKTOP_SECRET"];
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

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:30143${path}`, {
    headers: cookie ? { cookie: `${AUTH_COOKIE_NAME}=${cookie}` } : undefined,
  });
}

/** Where a redirect sends the request, or null when it is not a redirect. */
function redirectTarget(res: Response): string | null {
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
}

describe("server track (unchanged behaviour)", () => {
  it("401s an API call without a credential", () => {
    const res = authProxy(request("/api/sessions"));

    expect(res.status).toBe(401);
  });

  it("lets an API call through with a valid credential", () => {
    const res = authProxy(request("/api/sessions", createSessionToken()));

    expect(res.status).toBe(200);
    expect(redirectTarget(res)).toBeNull();
  });

  it("401s an API call with a stale credential", () => {
    const token = createSessionToken();
    process.env.PI_WORK_AUTH_PASSWORD = "changed";

    expect(authProxy(request("/api/sessions", token)).status).toBe(401);
  });

  it("redirects an unauthenticated page visit to the login page", () => {
    const res = authProxy(request("/"));

    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("/login");
  });

  it("serves the login page to an unauthenticated visitor", () => {
    const res = authProxy(request("/login"));

    expect(res.status).toBe(200);
    expect(redirectTarget(res)).toBeNull();
  });

  it("bounces an authenticated visitor away from the login page", () => {
    const res = authProxy(request("/login", createSessionToken()));

    expect(redirectTarget(res)).toBe("/");
  });
});

describe("desktop track", () => {
  function enterDesktopMode(secret = "launch-1") {
    process.env.PI_WORK_DESKTOP = "1";
    process.env.PI_WORK_DESKTOP_SECRET = secret;
  }

  it("401s an API call without a credential", () => {
    enterDesktopMode();

    expect(authProxy(request("/api/sessions")).status).toBe(401);
  });

  it("lets an API call through with the shell-injected credential", () => {
    enterDesktopMode();

    const res = authProxy(request("/api/sessions", createSessionToken()));
    expect(res.status).toBe(200);
    expect(redirectTarget(res)).toBeNull();
  });

  it("401s an API call carrying a credential from the previous launch", () => {
    enterDesktopMode("launch-1");
    const previousLaunch = createSessionToken();

    enterDesktopMode("launch-2");
    expect(authProxy(request("/api/sessions", previousLaunch)).status).toBe(401);
  });

  it("does not enter a login flow on /login", () => {
    enterDesktopMode();

    const anonymous = authProxy(request("/login"));
    expect(redirectTarget(anonymous)).toBe("/");

    const authed = authProxy(request("/login", createSessionToken()));
    expect(redirectTarget(authed)).toBe("/");
  });

  it("never redirects a page visit to the login page", () => {
    enterDesktopMode();

    const res = authProxy(request("/"));
    expect(res.status).toBe(200);
    expect(redirectTarget(res)).toBeNull();
  });

  it("keeps the session status endpoint reachable", () => {
    enterDesktopMode();

    expect(authProxy(request("/api/auth/session/status")).status).toBe(200);
  });
});
