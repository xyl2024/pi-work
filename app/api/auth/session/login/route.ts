import { NextResponse } from "next/server";
import {
  authCookieHeaders,
  getAuthUsername,
  isUsingDefaultCredentials,
  verifyCredentials,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/session/login  body: { username, password }
// Verifies credentials against PI_WORK_AUTH_USERNAME/PI_WORK_AUTH_PASSWORD
// (defaults: admin/admin) and sets the HttpOnly session cookie.
export async function POST(req: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await req.json()) as { username?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }

  if (!verifyCredentials(username, password)) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  const res = NextResponse.json({
    success: true,
    username: getAuthUsername(),
    usingDefaultCredentials: isUsingDefaultCredentials(),
  });
  // Two cookies: Lax (normal browser) + None/Secure (Electron iframe).
  for (const c of authCookieHeaders()) res.headers.append("Set-Cookie", c);
  return res;
}
