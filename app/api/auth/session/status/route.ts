import { NextResponse } from "next/server";
import {
  getAuthUsername,
  isRequestAuthenticated,
  isUsingDefaultCredentials,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/session/status — whether the current request is
// authenticated. Public endpoint (the login gate calls it before any cookie
// exists); leaks nothing but the username.
export async function GET(req: Request) {
  if (!isRequestAuthenticated(req)) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    username: getAuthUsername(),
    usingDefaultCredentials: isUsingDefaultCredentials(),
  });
}
