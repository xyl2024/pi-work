import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, isAuthDisabled, verifySessionToken } from "@/lib/server/auth";
import { isDesktopMode } from "@/lib/server/trust-boundary";

const LOGIN_PATH = "/login";

function isPublicPath(pathname: string): boolean {
  if (pathname === LOGIN_PATH) return true;
  if (pathname.startsWith("/api/auth/session/")) return true;
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function tokenAccepted(req: NextRequest): boolean {
  return verifySessionToken(req.cookies.get(AUTH_COOKIE_NAME)?.value);
}

function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(AUTH_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}

export default function authProxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const desktop = isDesktopMode();

  if (isAuthDisabled()) {
    if (pathname === LOGIN_PATH) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (desktop && pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (!req.cookies.get(AUTH_COOKIE_NAME)) {
    if (isPublicPath(pathname)) return NextResponse.next();
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (desktop) return NextResponse.next();
    return NextResponse.redirect(new URL(LOGIN_PATH, req.url));
  }

  if (tokenAccepted(req)) {
    if (pathname === LOGIN_PATH) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return clearSessionCookie(NextResponse.next());
  }
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (desktop) return NextResponse.next();
  return NextResponse.redirect(new URL(LOGIN_PATH, req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
