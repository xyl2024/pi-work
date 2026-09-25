import { NextResponse } from "next/server";
import {
  getAuthUsername,
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
  if (!isRequestAuthenticated(req)) {
    return NextResponse.json({ authenticated: false, desktop });
  }
  return NextResponse.json({
    authenticated: true,
    desktop,
    username: getAuthUsername(),
    usingDefaultCredentials: isUsingDefaultCredentials(),
  });
}
