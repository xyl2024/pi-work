import { NextResponse } from "next/server";
import {
  getAuthUsername,
  isAuthDisabled,
  isLoginEnabled,
  isRequestAuthenticated,
  isUsingDefaultCredentials,
} from "@/lib/server/auth";
import { isDesktopMode } from "@/lib/server/trust-boundary";

export const dynamic = "force-dynamic";

// GET /api/auth/session/status — whether the current request is
// authenticated. Public endpoint (the login gate calls it before any cookie
// exists); leaks nothing but the username and which track signs sessions.
export async function GET(req: Request) {
  const desktop = isDesktopMode();
  const authDisabled = isAuthDisabled();
  const loginEnabled = isLoginEnabled();
  if (!isRequestAuthenticated(req)) {
    return NextResponse.json({ authenticated: false, desktop, authDisabled, loginEnabled });
  }
  return NextResponse.json({
    authenticated: true,
    desktop,
    authDisabled,
    loginEnabled,
    username: authDisabled ? null : getAuthUsername(),
    usingDefaultCredentials: isUsingDefaultCredentials(),
  });
}
