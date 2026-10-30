import { NextResponse } from "next/server";
import { authClearCookieHeaders, isLoginEnabled } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isLoginEnabled()) {
    return NextResponse.json({ error: "logout is disabled in this deployment mode" }, { status: 403 });
  }
  const res = NextResponse.json({ success: true });
  for (const c of authClearCookieHeaders()) res.headers.append("Set-Cookie", c);
  return res;
}
