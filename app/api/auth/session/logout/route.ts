import { NextResponse } from "next/server";
import { authClearCookieHeaders, isLoginEnabled } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/session/logout — clear the session cookie.
//
// Desktop mode does not own its credential (the shell signs and injects the
// cookie), so the web UI cannot revoke it; clearing it would only lock the
// running app out of itself until the shell restarts.
export async function POST() {
  if (!isLoginEnabled()) {
    return NextResponse.json({ error: "logout is disabled in desktop mode" }, { status: 403 });
  }
  const res = NextResponse.json({ success: true });
  for (const c of authClearCookieHeaders()) res.headers.append("Set-Cookie", c);
  return res;
}
