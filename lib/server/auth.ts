// Session authentication for the Pi Work web UI.
//
// The session cookie is stateless: `<expiresAtMs>.<hmac>` where the HMAC key
// is derived from whatever the trust boundary says signs this process, so
// changing that key instantly invalidates all existing sessions and the token
// can be verified anywhere in this process (route handlers AND the
// proxy/middleware bundle) without shared mutable state.
//
// Two issuers (see lib/shared/trust-boundary.ts):
//
//   - server track: the key comes from PI_WORK_AUTH_USERNAME /
//     PI_WORK_AUTH_PASSWORD (defaults: admin/admin) and the login page issues
//     the cookie;
//   - desktop track (PI_WORK_DESKTOP): the Electron shell is the issuer. It
//     mints PI_WORK_DESKTOP_SECRET once per launch and signs the cookie itself:
//         key = sha256("pi-work-desktop:" + secret)
//         token = `${Date.now() + AUTH_SESSION_TTL_MS}.${hmacSha256(key, expiresAtMs)}`
//     The shell injects that token as the `pi-work-auth` cookie before the
//     window loads; there is no login page to mint one. The shell half of this
//     contract is built with the shell — this file is the server half, which
//     only verifies what the shell signed.
//
// Web UI auth only — never used for the pi agent session, terminal WS (has its
// own random token) or LLM provider credentials.

import { createHmac, createHash, timingSafeEqual } from "crypto";
import { isDesktopMode } from "@/lib/server/trust-boundary";
import { trustBoundary } from "@/lib/shared/trust-boundary";

export const AUTH_COOKIE_NAME = "pi-work-auth";
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
  // Desktop mode has no credential pair at all; nothing to warn about.
  if (isDesktopMode()) return false;
  return !process.env.PI_WORK_AUTH_PASSWORD?.trim() && !process.env.PI_WORK_AUTH_USERNAME?.trim();
}

/** The trust boundary in effect for this process. */
function currentTrustBoundary() {
  return trustBoundary({
    desktop: isDesktopMode(),
    desktopSecret: process.env.PI_WORK_DESKTOP_SECRET,
    credentials: { username: getAuthUsername(), password: getAuthPassword() },
  });
}

/** Whether the login page and the credential login endpoint exist at all. */
export function isLoginEnabled(): boolean {
  return currentTrustBoundary().loginEnabled;
}

/**
 * Derive the signing key from the trust boundary so changing it revokes every
 * session. `null` means nothing can be signed or verified (desktop mode
 * without a secret).
 */
function authSecret(): Buffer | null {
  const material = currentTrustBoundary().sessionKeyMaterial;
  return material === null ? null : createHash("sha256").update(material).digest();
}

function sign(expiresAtMs: number, secret: Buffer): string {
  return createHmac("sha256", secret).update(String(expiresAtMs)).digest("hex");
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
  const secret = authSecret();
  if (!secret) {
    // Desktop mode without PI_WORK_DESKTOP_SECRET: the shell mints the cookie,
    // this process has nothing to sign with.
    throw new Error(
      "no session signer: PI_WORK_DESKTOP is set but PI_WORK_DESKTOP_SECRET is empty",
    );
  }
  const expiresAtMs = now + AUTH_SESSION_TTL_MS;
  return `${expiresAtMs}.${sign(expiresAtMs, secret)}`;
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
  const secret = authSecret();
  if (!secret) return false;
  return safeEqual(sig, sign(expiresAtMs, secret));
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

/** Read the auth cookie from a Request's Cookie header (no next/headers
 *  dep; accepts NextRequest-style objects with cookie()/get). */
export function readAuthToken(req: { headers: { get(name: string): string | null } }): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  return extractCookie(header, AUTH_COOKIE_NAME);
}

/** Whether this request carries a valid signed auth session. */
export function isRequestAuthenticated(req: Request): boolean {
  return verifySessionToken(readAuthToken(req));
}

/** Set-Cookie header values for a fresh login session. */
export function authCookieHeaders(): string[] {
  const token = encodeURIComponent(createSessionToken());
  const maxAge = Math.floor(AUTH_SESSION_TTL_MS / 1000);
  return [`${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`];
}

/** Set-Cookie header values that clear the session cookie. */
export function authClearCookieHeaders(): string[] {
  return [`${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`];
}
