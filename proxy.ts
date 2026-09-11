// Global authentication gateway (Next.js 16 "proxy" convention — formerly
// middleware.ts).
//
// Every request passes through here:
//   - page navigations            → redirect to /login when unauthenticated
//   - /api/** calls               → 401 JSON when unauthenticated
//   - /login and /api/auth/session/** (login/logout/status) → always pass
//
// Verification is pure cookie + HMAC (see lib/server/auth.ts), so no Node
// APIs or shared session state are needed here. Two cookies carry the same
// signed token: a SameSite=Lax one for normal browsers and a
// SameSite=None;Secure one for the Electron shell (the app runs in an
// iframe of a file:// page, where Lax cookies are third-party and not sent).
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_COOKIE_NAME_NONE, verifySessionToken } from "@/lib/server/auth";

const LOGIN_PATH = "/login";

/** Paths served without an auth session. */
function isPublicPath(pathname: string): boolean {
  if (pathname === LOGIN_PATH) return true;
  if (pathname.startsWith("/api/auth/session/")) return true;
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function tokenAccepted(req: NextRequest): boolean {
  return (
    verifySessionToken(req.cookies.get(AUTH_COOKIE_NAME)?.value) ||
    verifySessionToken(req.cookies.get(AUTH_COOKIE_NAME_NONE)?.value)
  );
}

function clearBothCookies(res: NextResponse): NextResponse {
  res.cookies.set(AUTH_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  res.cookies.set(AUTH_COOKIE_NAME_NONE, "", { path: "/", maxAge: 0, sameSite: "none", secure: true });
  return res;
}

export default function authProxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Fast path without touching crypto: no auth cookie at all can't be a
  // session.
  if (!req.cookies.get(AUTH_COOKIE_NAME) && !req.cookies.get(AUTH_COOKIE_NAME_NONE)) {
    if (isPublicPath(pathname)) return NextResponse.next();
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL(LOGIN_PATH, req.url));
  }

  if (tokenAccepted(req)) {
    // Already signed in — the login page is pointless, bounce to the app.
    if (pathname === LOGIN_PATH) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  // Stale/invalid cookie: treat like no session, but make sure the page that
  // renders /login clears the useless cookies first.
  if (isPublicPath(pathname)) {
    return clearBothCookies(NextResponse.next());
  }
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL(LOGIN_PATH, req.url));
}

export const config = {
  // Everything except Next internals and the favicon; /login,
  // /api/auth/session/* are let through inside the handler above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
