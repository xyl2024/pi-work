// Username/password authentication for the Pi Work web UI.
//
// Credentials come from environment variables:
//   PI_WORK_AUTH_USERNAME — login username (default: "admin")
//   PI_WORK_AUTH_PASSWORD — login password (default: "admin")
//
// The session cookie is stateless: `<expiresAtMs>.<hmac>` where the HMAC key
// is derived from the credentials, so a password change instantly invalidates
// all existing sessions and the token can be verified anywhere in this
// process (route handlers AND the proxy/middleware bundle) without shared
// mutable state. Web UI auth only — never used for the pi agent session,
// terminal WS (has its own random token) or LLM provider credentials.

import { createHmac, createHash, timingSafeEqual } from "crypto";

export const AUTH_COOKIE_NAME = "pi-work-auth";
/** Clone of the session cookie with SameSite=None; Secure. The Electron shell
 *  embeds the web app in an <iframe> of a file:// page, so Chromium treats
 *  every request from it as third-party and SameSite=Lax cookies are not
 *  sent. http://localhost is a trustworthy origin, so Chromium accepts this
 *  Secure cookie and attaches it inside the iframe. Normal browsers keep
 *  using the Lax cookie (works even over plain http LAN access). */
export const AUTH_COOKIE_NAME_NONE = "pi-work-auth-n";
/** Session lifetime: 7 days, matching the cookie Max-Age. */
export const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";

function envCredential(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function getAuthUsername(): string {
  return envCredential("PI_WORK_AUTH_USERNAME", DEFAULT_USERNAME);
}

export function getAuthPassword(): string {
  return envCredential("PI_WORK_AUTH_PASSWORD", DEFAULT_PASSWORD);
}

/** True when the operator hasn't overridden the built-in admin/admin pair. */
export function isUsingDefaultCredentials(): boolean {
  return !process.env.PI_WORK_AUTH_PASSWORD?.trim() && !process.env.PI_WORK_AUTH_USERNAME?.trim();
}

/** Derive the signing key from the credentials so password changes revoke sessions. */
function authSecret(): Buffer {
  return createHash("sha256")
    .update(`pi-work-auth:${getAuthUsername()}:${getAuthPassword()}`)
    .digest();
}

function sign(expiresAtMs: number): string {
  return createHmac("sha256", authSecret()).update(String(expiresAtMs)).digest("hex");
}

/** Constant-time string equality; false on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyCredentials(username: string, password: string): boolean {
  return safeEqual(username.trim(), getAuthUsername()) && safeEqual(password, getAuthPassword());
}

/** Create a signed session token valid for AUTH_SESSION_TTL_MS from now. */
export function createSessionToken(now = Date.now()): string {
  const expiresAtMs = now + AUTH_SESSION_TTL_MS;
  return `${expiresAtMs}.${sign(expiresAtMs)}`;
}

/** Verify a signed session token; returns true when valid and unexpired. */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresRaw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expiresAtMs = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) return false;
  return safeEqual(sig, sign(expiresAtMs));
}

function extractCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Read both auth cookies from a Request's Cookie header (no next/headers
 *  dep; accepts NextRequest-style objects with cookie()/get). */
export function readAuthToken(req: { headers: { get(name: string): string | null } }): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  return extractCookie(header, AUTH_COOKIE_NAME) ?? extractCookie(header, AUTH_COOKIE_NAME_NONE);
}

/** Whether this request carries a valid signed auth session (either cookie). */
export function isRequestAuthenticated(req: Request): boolean {
  return verifySessionToken(readAuthToken(req));
}

/** Set-Cookie header values for a fresh login session (Lax + None/Secure). */
export function authCookieHeaders(): string[] {
  const token = encodeURIComponent(createSessionToken());
  const maxAge = Math.floor(AUTH_SESSION_TTL_MS / 1000);
  return [
    `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
    `${AUTH_COOKIE_NAME_NONE}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAge}`,
  ];
}

/** Set-Cookie header values that clear both session cookies. */
export function authClearCookieHeaders(): string[] {
  return [
    `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${AUTH_COOKIE_NAME_NONE}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`,
  ];
}
