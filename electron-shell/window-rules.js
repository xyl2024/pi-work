// window-rules.js — pure rules for the shell window: where it points, and what
// counts as leaving the app.
//
// Both decisions are taken out of main.js so they can be unit-tested without
// launching Electron (tests/unit/electron-shell-window-rules.test.ts). The
// facts they depend on — the mode flag and the environment — arrive as explicit
// arguments: this module reads neither `process.platform` nor `process.env`
// (ADR-0003 rule 3, same shape as `lib/shared/trust-boundary.ts`).
//
// It lives here rather than in `lib/shared` because the Electron main process
// loads it as plain CommonJS, with no bundler and no path aliases.
//
// The two port defaults are duplicated from the launchers that own them
// (`bin/pi-work.js`, `scripts/dev-isolated.mjs`); that drift is caught by the
// test above rather than by an import.

/** Production web instance's default port (`pnpm start`, `bin/pi-work.js`). */
const PROD_PORT = "30141";
/** Isolated dev instance's default port (`scripts/dev-isolated.mjs`). */
const DEV_PORT = "30143";
/** Loopback only: the shell is a desktop client of a local server. */
const HOST = "127.0.0.1";
/** Schemes the OS itself knows how to open (mail client, dialer, …). */
const OS_HANDLED_SCHEMES = new Set(["mailto:", "tel:"]);
/**
 * Scheme the shell's own pages use to talk to the main process, and the one
 * command it carries: "restart the server, then load the app". It exists so
 * the error page's retry button needs no preload/IPC bridge (there is none).
 * Chromium would refuse to navigate to it anyway — the main process cancels
 * that navigation and runs the command itself.
 */
const SHELL_COMMAND_SCHEME = "pi-work:";
const RETRY_COMMAND = "pi-work://retry";

/**
 * `PI_PORT` as a usable port string, or `null` when absent / malformed.
 *
 * Exported because it is also the shell's "a server already exists" signal: a
 * usable PI_PORT means the operator pointed the shell at their own server, so
 * it must not spawn one (see server-process.js' `shouldSpawnServer`).
 */
function portOverride(env) {
  const raw = (env.PI_PORT ?? "").trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return String(port);
}

/**
 * The URL the shell window loads.
 *
 *   - `PI_PORT` wins in both modes: the shell's own server spawner hands the
 *     window the port it actually picked (#88);
 *   - otherwise dev mode points at the *isolated* instance (port 30143,
 *     separate data root), so debugging never touches production data;
 *   - otherwise the production default (30141).
 */
function resolveAppUrl({ dev, env = {} }) {
  const port = portOverride(env) ?? (dev ? DEV_PORT : PROD_PORT);
  return `http://${HOST}:${port}`;
}

/**
 * Whether a navigation target leaves the app and must therefore be handed to
 * the default browser instead of replacing Pi Work in the window.
 *
 *   - `http(s)`: external when the origin differs from the app's;
 *   - `mailto:` / `tel:`: external (the OS opens them);
 *   - anything else (`data:`, `file:`, `about:`, `ws:`…) is *not* external,
 *     because it must never be handed to an OS handler. Chromium's own rules
 *     already apply to those: a page cannot navigate the top frame to a
 *     `data:`/`file:` URL. The shell's error page is a `data:` URL loaded from
 *     the main process, which does not come through this check at all.
 */
function isExternalNavigation(url, appOrigin) {
  if (typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.origin !== appOrigin;
  }
  return OS_HANDLED_SCHEMES.has(parsed.protocol);
}

/**
 * Whether a navigation target is one of the shell's own pages' commands rather
 * than a page to load. Checked before `isExternalNavigation`, which would
 * otherwise classify it as "not external" and let Chromium fail the navigation.
 */
function isShellCommand(url) {
  if (typeof url !== "string") return false;
  return url.startsWith(SHELL_COMMAND_SCHEME);
}

/**
 * Whether the window currently shows the app itself rather than the shell's
 * error page. Used to decide what Ctrl+R and the tray's "重新加载" should do:
 * reloading the error page would just show it again.
 */
function isAppUrl(url, appOrigin) {
  if (typeof url !== "string") return false;
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

module.exports = {
  resolveAppUrl,
  isExternalNavigation,
  isAppUrl,
  isShellCommand,
  portOverride,
  RETRY_COMMAND,
  PROD_PORT,
  DEV_PORT,
};
