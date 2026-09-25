// The Electron shell's window rules (electron-shell/window-rules.js) are pure:
// the mode flag and the environment arrive as arguments, so both branches —
// including the dev one — can be driven from here without launching Electron
// or a server. Same shape as tests/unit/trust-boundary.test.ts.
//
// What is worth guarding: the window must point at *loopback*, dev mode must
// point at the isolated instance (never production data), and an explicit
// PI_PORT must win (that is how the shell's own spawner hands over the port it
// picked).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEV_PORT, PROD_PORT, RETRY_COMMAND, isAppUrl, isExternalNavigation, isShellCommand, resolveAppUrl } from "../../electron-shell/window-rules.js";

const APP_ORIGIN = "http://127.0.0.1:30141";

describe("resolveAppUrl", () => {
  it("points at the production instance by default", () => {
    expect(resolveAppUrl({ dev: false })).toBe(`http://127.0.0.1:${PROD_PORT}`);
  });

  it("points at the isolated dev instance in dev mode", () => {
    expect(resolveAppUrl({ dev: true })).toBe(`http://127.0.0.1:${DEV_PORT}`);
    expect(DEV_PORT).not.toBe(PROD_PORT);
  });

  it("binds loopback, never a LAN address", () => {
    for (const dev of [false, true]) {
      expect(new URL(resolveAppUrl({ dev })).hostname).toBe("127.0.0.1");
    }
  });

  it("lets PI_PORT override the mode default (the spawner hands over its port)", () => {
    expect(resolveAppUrl({ dev: false, env: { PI_PORT: "45678" } })).toBe("http://127.0.0.1:45678");
    expect(resolveAppUrl({ dev: true, env: { PI_PORT: "45678" } })).toBe("http://127.0.0.1:45678");
  });

  it("falls back to the mode default for an unusable PI_PORT", () => {
    for (const value of ["", "   ", "abc", "0", "-1", "70000", "1.5"]) {
      expect(resolveAppUrl({ dev: false, env: { PI_PORT: value } })).toBe(
        `http://127.0.0.1:${PROD_PORT}`
      );
      expect(resolveAppUrl({ dev: true, env: { PI_PORT: value } })).toBe(
        `http://127.0.0.1:${DEV_PORT}`
      );
    }
  });
});

describe("isExternalNavigation", () => {
  it("keeps same-origin navigation in the window", () => {
    expect(isExternalNavigation(`${APP_ORIGIN}/`, APP_ORIGIN)).toBe(false);
    expect(isExternalNavigation(`${APP_ORIGIN}/?session=abc#x`, APP_ORIGIN)).toBe(false);
  });

  it("sends other web origins to the default browser", () => {
    expect(isExternalNavigation("https://github.com/xyl2024/pi-work", APP_ORIGIN)).toBe(true);
    expect(isExternalNavigation("http://127.0.0.1:30142/", APP_ORIGIN)).toBe(true);
    expect(isExternalNavigation("http://localhost:30141/", APP_ORIGIN)).toBe(true);
  });

  it("sends OS-handled schemes to the default handler", () => {
    expect(isExternalNavigation("mailto:someone@example.com", APP_ORIGIN)).toBe(true);
    expect(isExternalNavigation("tel:+123456789", APP_ORIGIN)).toBe(true);
  });

  it("leaves non-web schemes alone — Chromium's own navigation rules apply", () => {
    // Never handed to an OS handler: `shell.openExternal` on a data:/file: URL
    // would feed it to whatever is registered for that scheme.
    expect(isExternalNavigation("data:text/html,<h1>offline</h1>", APP_ORIGIN)).toBe(false);
    expect(isExternalNavigation("about:blank", APP_ORIGIN)).toBe(false);
    expect(isExternalNavigation("file:///tmp/pi-work/error.html", APP_ORIGIN)).toBe(false);
    expect(isExternalNavigation("ws://127.0.0.1:30142/terminal", APP_ORIGIN)).toBe(false);
  });

  it("ignores values that are not URLs", () => {
    expect(isExternalNavigation(undefined, APP_ORIGIN)).toBe(false);
    expect(isExternalNavigation("not a url", APP_ORIGIN)).toBe(false);
  });
});

describe("isAppUrl", () => {
  it("recognizes the app, whatever route it is on", () => {
    expect(isAppUrl(`${APP_ORIGIN}/`, APP_ORIGIN)).toBe(true);
    expect(isAppUrl(`${APP_ORIGIN}/?session=abc#entry`, APP_ORIGIN)).toBe(true);
  });

  it("does not recognize the shell's error page or anything else", () => {
    expect(isAppUrl("data:text/html,<h1>offline</h1>", APP_ORIGIN)).toBe(false);
    expect(isAppUrl(`${APP_ORIGIN}.evil.com/`, APP_ORIGIN)).toBe(false);
    expect(isAppUrl("http://localhost:30141/", APP_ORIGIN)).toBe(false);
    expect(isAppUrl("", APP_ORIGIN)).toBe(false);
    expect(isAppUrl(undefined, APP_ORIGIN)).toBe(false);
  });
});

describe("isShellCommand", () => {
  it("recognizes the shell's own commands", () => {
    expect(isShellCommand(RETRY_COMMAND)).toBe(true);
    expect(RETRY_COMMAND).toBe("pi-work://retry");
  });

  it("leaves real targets alone", () => {
    // Anything a link could carry: `pi-work:` must never swallow it, and the
    // retry command must never be handed to an OS handler.
    for (const url of [`${APP_ORIGIN}/`, "https://github.com/xyl2024/pi-work", "pi-workx://retry", "not a url", ""]) {
      expect(isShellCommand(url)).toBe(false);
    }
    expect(isShellCommand(undefined)).toBe(false);
    expect(isExternalNavigation(RETRY_COMMAND, APP_ORIGIN)).toBe(false);
  });
});

// The two ports are duplicated between the shell and the launchers that own
// them; a silent drift would send dev mode at production data (or the window at
// nothing at all), which no other test can see.
describe("port defaults agree with the launchers", () => {
  const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

  it("DEV_PORT is the isolated instance's port", () => {
    const script = read("scripts/dev-isolated.mjs");
    expect(script).toMatch(new RegExp(`const DEFAULT_PORT = ${DEV_PORT};`));
  });

  it("PROD_PORT is bin/pi-work.js's default port", () => {
    const script = read("bin/pi-work.js");
    expect(script).toMatch(new RegExp(`process\\.env\\.PORT\\s*\\?\\?\\s*"${PROD_PORT}"`));
  });
});
