import { NextResponse } from "next/server";
import { authClearCookieHeaders } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/session/logout — clear the session cookies.
export async function POST() {
  const res = NextResponse.json({ success: true });
  for (const c of authClearCookieHeaders()) res.headers.append("Set-Cookie", c);
  return res;
}
