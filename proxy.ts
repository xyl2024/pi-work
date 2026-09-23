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
//
// Desktop mode (PI_WORK_DESKTOP) has no login page: the shell signs the cookie
// and injects it into the window before the app loads. There, /login is not a
// route and an unauthenticated page visit is never redirected to it — that
// redirect would loop with the one below. Every /api call is still 401
// without a valid cookie.
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_COOKIE_NAME_NONE, verifySessionToken } from "@/lib/server/auth";
import { isDesktopMode } from "@/lib/server/trust-boundary";

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
  const desktop = isDesktopMode();

  // Desktop mode has no login page. Bounce it before anything else so the
  // login form is never rendered there, cookie or no cookie.
  if (desktop && pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Fast path without touching crypto: no auth cookie at all can't be a
  // session.
  if (!req.cookies.get(AUTH_COOKIE_NAME) && !req.cookies.get(AUTH_COOKIE_NAME_NONE)) {
    if (isPublicPath(pathname)) return NextResponse.next();
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // Desktop pages are served without a login redirect; the shell injects the
    // cookie, and the app's own gate reports whatever the session really is.
    if (desktop) return NextResponse.next();
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
  if (desktop) return NextResponse.next();
  return NextResponse.redirect(new URL(LOGIN_PATH, req.url));
}

export const config = {
  // Everything except Next internals and the favicon; /login,
  // /api/auth/session/* are let through inside the handler above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
