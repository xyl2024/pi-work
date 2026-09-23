/**
 * The trust boundary: who may reach this process, and who signs a session.
 *
 * One mechanism, two issuers — only the issuer changes, never how trust is
 * carried (the cookie, its names, the routes and the client's fetches are all
 * untouched):
 *
 *   - **server track** (the default): the session HMAC key is derived from
 *     `PI_WORK_AUTH_USERNAME` / `PI_WORK_AUTH_PASSWORD`, the login page exists,
 *     and `PI_WORK_AUTH_*` behaves exactly as it always has;
 *   - **desktop track** (`PI_WORK_DESKTOP`): the Electron shell owns this
 *     process and is the issuer — it mints a random secret once per launch,
 *     passes it as `PI_WORK_DESKTOP_SECRET`, signs the session cookie with it
 *     and injects that cookie into the window before the app loads. The login
 *     page is closed and every service binds loopback.
 *
 * The desktop track is a contract with the shell, not something the web app can
 * exercise on its own: the server half (this module plus `lib/server/auth.ts`
 * and `proxy.ts`) verifies what the shell signed; the shell half — minting the
 * secret, signing the cookie, spawning the server on loopback — is built with
 * the shell.
 *
 * A desktop launch therefore has no stable credential at all: restarting the
 * shell invalidates every cookie the previous launch signed.
 *
 * The environment arrives as an explicit argument — this module never reads
 * `process.env` itself (ADR-0003 rule 3), which is what lets the desktop branch
 * be unit-tested on a machine that is not running the shell. The server-side
 * adapter that supplies the real values is `lib/server/trust-boundary.ts`.
 */

/** The only address any Pi Work service may bind outside the desktop track. */
export const LOOPBACK_HOST = "127.0.0.1";

/** `PI_WORK_DESKTOP` values that mean "off"; anything else non-empty means "on". */
const FALSY_FLAGS = new Set(["0", "false", "no", "off"]);

/** Whether the environment asks for the desktop track (`PI_WORK_DESKTOP`). */
export function desktopModeRequested(env: Record<string, string | undefined>): boolean {
  const value = env.PI_WORK_DESKTOP?.trim().toLowerCase();
  if (!value) return false;
  return !FALSY_FLAGS.has(value);
}

export interface TrustBoundaryInput {
  /** Whether the desktop track is in effect (see `desktopModeRequested`). */
  desktop: boolean;
  /** `PI_WORK_DESKTOP_SECRET`: the shell's random value for this launch. */
  desktopSecret: string | undefined;
  /** The server track's credentials, defaults already applied by the caller. */
  credentials: { username: string; password: string };
}

export interface TrustBoundary {
  desktop: boolean;
  /** Whether the login page (and the credential login endpoint) exists at all. */
  loginEnabled: boolean;
  /** What the session HMAC key is derived from; `null` = nothing can be signed. */
  sessionKeyMaterial: string | null;
}

/** The trust boundary in effect for the given environment facts. */
export function trustBoundary({
  desktop,
  desktopSecret,
  credentials,
}: TrustBoundaryInput): TrustBoundary {
  if (!desktop) {
    return {
      desktop: false,
      loginEnabled: true,
      sessionKeyMaterial: `pi-work-auth:${credentials.username}:${credentials.password}`,
    };
  }
  const secret = desktopSecret?.trim();
  return {
    desktop: true,
    loginEnabled: false,
    // Desktop mode without a secret signs nothing. The shell always passes one;
    // falling back to the credentials here would put the built-in admin/admin
    // pair back behind a loopback port.
    sessionKeyMaterial: secret ? `pi-work-desktop:${secret}` : null,
  };
}

export interface TerminalHostInput {
  desktop: boolean;
  env: Record<string, string | undefined>;
}

/**
 * The address the terminal WebSocket service binds. Loopback by default — it
 * used to be `0.0.0.0`, which put the terminal (and the token that gates it) on
 * the LAN. `PI_WORK_TERMINAL_HOST` still opens it up for a server that wants
 * LAN clients; the desktop track ignores it, because the shell owns that
 * process.
 */
export function resolveTerminalHost({ desktop, env }: TerminalHostInput): string {
  if (desktop) return LOOPBACK_HOST;
  return env.PI_WORK_TERMINAL_HOST?.trim() || LOOPBACK_HOST;
}
