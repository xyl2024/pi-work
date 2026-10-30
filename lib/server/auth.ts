import { createHmac, createHash, timingSafeEqual } from "crypto";
import { isDesktopMode } from "@/lib/server/trust-boundary";
import { authDisabledRequested, trustBoundary } from "@/lib/shared/trust-boundary";

export const AUTH_COOKIE_NAME = "pi-work-auth";
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

export function isUsingDefaultCredentials(): boolean {
  if (!isLoginEnabled()) return false;
  return !process.env.PI_WORK_AUTH_PASSWORD?.trim() && !process.env.PI_WORK_AUTH_USERNAME?.trim();
}

function currentTrustBoundary() {
  return trustBoundary({
    desktop: isDesktopMode(),
    authDisabled: authDisabledRequested(process.env),
    desktopSecret: process.env.PI_WORK_DESKTOP_SECRET,
    credentials: { username: getAuthUsername(), password: getAuthPassword() },
  });
}

export function isAuthDisabled(): boolean {
  return currentTrustBoundary().authDisabled;
}

export function isLoginEnabled(): boolean {
  return currentTrustBoundary().loginEnabled;
}

function authSecret(): Buffer | null {
  const material = currentTrustBoundary().sessionKeyMaterial;
  return material === null ? null : createHash("sha256").update(material).digest();
}

function sign(expiresAtMs: number, secret: Buffer): string {
  return createHmac("sha256", secret).update(String(expiresAtMs)).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyCredentials(username: string, password: string): boolean {
  return safeEqual(username.trim(), getAuthUsername()) && safeEqual(password, getAuthPassword());
}

export function createSessionToken(now = Date.now()): string {
  const secret = authSecret();
  if (!secret) {
    throw new Error(
      "no session signer: authentication is disabled or PI_WORK_DESKTOP_SECRET is empty",
    );
  }
  const expiresAtMs = now + AUTH_SESSION_TTL_MS;
  return `${expiresAtMs}.${sign(expiresAtMs, secret)}`;
}

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

export function readAuthToken(req: { headers: { get(name: string): string | null } }): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  return extractCookie(header, AUTH_COOKIE_NAME);
}

export function isRequestAuthenticated(req: Request): boolean {
  return isAuthDisabled() || verifySessionToken(readAuthToken(req));
}

export function authCookieHeaders(): string[] {
  const token = encodeURIComponent(createSessionToken());
  const maxAge = Math.floor(AUTH_SESSION_TTL_MS / 1000);
  return [`${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`];
}

export function authClearCookieHeaders(): string[] {
  return [`${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`];
}
