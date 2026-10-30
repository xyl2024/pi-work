import { NextResponse } from "next/server";
import {
  authCookieHeaders,
  getAuthUsername,
  isLoginEnabled,
  isUsingDefaultCredentials,
  verifyCredentials,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isLoginEnabled()) {
    return NextResponse.json({ error: "login is disabled in this deployment mode" }, { status: 403 });
  }
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
  for (const c of authCookieHeaders()) res.headers.append("Set-Cookie", c);
  return res;
}
