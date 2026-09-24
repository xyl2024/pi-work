// The Electron shell's lifetime rules (electron-shell/lifecycle.js) are pure:
// visibility, "is a quit in progress" and "is there a tray icon" arrive as
// arguments, so both branches are driven from here without launching Electron.
// Same shape as tests/unit/electron-shell-window-rules.test.ts.
//
// What is worth guarding: the window's visibility and the app's lifetime are
// two different things. The 定时任务 / RSS / 看板 / 频道 loops run inside the
// server process the shell owns, so closing the window must hide it rather than
// end anything; only a quit may take the process tree down (#89). The tray menu
// is the window's only way back, because the shell has no other UI of its own.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TRAY_ITEM,
  keepsRunningWithoutWindow,
  trayMenu,
  windowCloseAction,
  windowShowsOnStart,
  windowToggleAction,
} from "../../electron-shell/lifecycle.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

/** The menu entry with this id, or a failure naming what was actually there. */
function item(menu: Array<{ id?: string; label?: string; type?: string }>, id: string) {
  const found = menu.find((entry) => entry.id === id);
  if (!found) throw new Error(`no ${id} in [${menu.map((entry) => entry.id ?? entry.type).join(", ")}]`);
  return found;
}

describe("windowCloseAction", () => {
  it("hides the window into the tray while the app keeps running", () => {
    expect(windowCloseAction({ isQuitting: false, hasTray: true })).toBe("hide");
  });

  it("really closes the window once a quit is in progress", () => {
    // The quit path closes windows itself; preventing that close would cancel
    // the quit (and with it the `will-quit` that reaps the server).
    expect(windowCloseAction({ isQuitting: true, hasTray: true })).toBe("close");
  });

  it("never hides the window when no tray can bring it back", () => {
    // A hidden window with no way back is an app running with no UI at all —
    // worse than ending it, because the user cannot even get to "退出".
    expect(windowCloseAction({ isQuitting: false, hasTray: false })).toBe("close");
  });
});

describe("keepsRunningWithoutWindow", () => {
  it("outlives its window behind the tray, so the background loops keep running", () => {
    expect(keepsRunningWithoutWindow({ isQuitting: false, hasTray: true })).toBe(true);
  });

  it("does not outlive its last window when nothing can reopen it", () => {
    expect(keepsRunningWithoutWindow({ isQuitting: false, hasTray: false })).toBe(false);
  });

  it("does not outlive a quit that is already under way", () => {
    expect(keepsRunningWithoutWindow({ isQuitting: true, hasTray: true })).toBe(false);
  });
});

describe("windowShowsOnStart", () => {
  it("shows the window on an ordinary launch", () => {
    expect(windowShowsOnStart({ launchHidden: false, hasStarted: false })).toBe(true);
  });

  it("stays hidden for an autostart (--hidden) launch", () => {
    expect(windowShowsOnStart({ launchHidden: true, hasStarted: false })).toBe(false);
  });

  it("shows the window whenever someone asks for it later", () => {
    // The tray's toggle, a second launch and the error page's retry all go
    // through startApp: a `--hidden` autostart must not make those permanent.
    expect(windowShowsOnStart({ launchHidden: true, hasStarted: true })).toBe(true);
    expect(windowShowsOnStart({ launchHidden: false, hasStarted: true })).toBe(true);
  });
});

describe("windowToggleAction", () => {
  it("hides a visible window and shows a hidden one", () => {
    expect(windowToggleAction({ windowVisible: true })).toBe("hide");
    expect(windowToggleAction({ windowVisible: false })).toBe("show");
  });
});

describe("trayMenu", () => {
  it("offers to hide the window while it is showing", () => {
    expect(item(trayMenu({ windowVisible: true }), TRAY_ITEM.TOGGLE_WINDOW).label).toBe("隐藏窗口");
  });

  it("offers to show the window while it is hidden", () => {
    expect(item(trayMenu({ windowVisible: false }), TRAY_ITEM.TOGGLE_WINDOW).label).toBe("显示窗口");
  });

  it("announces the direction it will take", () => {
    // Label and action are one decision: an item that says 隐藏窗口 while the
    // handler shows the window (or the other way round) is a lie the user acts
    // on. The wording itself is pinned above; this pins the pairing.
    for (const windowVisible of [true, false]) {
      const toggle = item(trayMenu({ windowVisible }), TRAY_ITEM.TOGGLE_WINDOW);
      expect(toggle.label === "隐藏窗口").toBe(windowToggleAction({ windowVisible }) === "hide");
    }
  });

  it("carries the window toggle, a reload and quit — quit last", () => {
    const ids = trayMenu({ windowVisible: true })
      .map((entry) => entry.id ?? entry.type)
      .filter((id) => id !== "separator");
    expect(ids).toEqual([TRAY_ITEM.TOGGLE_WINDOW, TRAY_ITEM.RELOAD, TRAY_ITEM.QUIT]);
  });

  it("keeps the reload item while the window sits on the error page", () => {
    // Reload is the recovery path for a server that went away, so it must not
    // depend on the window being visible or the app being healthy.
    for (const windowVisible of [true, false]) {
      expect(item(trayMenu({ windowVisible }), TRAY_ITEM.RELOAD).label).toBe("重新加载");
    }
  });

  it("separates the app-level quit from the window-level items", () => {
    const menu = trayMenu({ windowVisible: true });
    const kinds = menu.map((entry) => entry.id ?? entry.type);
    expect(kinds.indexOf("separator")).toBeLessThan(kinds.indexOf(TRAY_ITEM.QUIT));
    expect(kinds.filter((kind) => kind === "separator")).toHaveLength(1);
  });
});

// ADR-0003 rule 3: a rule module takes its inputs as parameters instead of
// reading them. Here that is what lets the hidden-window branch be driven on a
// machine with no tray and no Electron, and it is why main.js — the half that
// cannot be unit-tested — is the only place that reads process.*.
describe("lifecycle.js stays a rule module", () => {
  const source = read("electron-shell/lifecycle.js");

  it("never reads process.platform or process.env itself", () => {
    // Comments legitimately discuss both, so only code lines are checked.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/process\.(platform|env)\b/);
  });

  it("imports no Electron and no other module", () => {
    // It is loaded by the Electron main process as plain CommonJS and by these
    // tests as plain ESM: no bundler, no path aliases, no Electron object.
    expect(source).not.toMatch(/require\(["']electron["']\)/);
    expect(source).not.toMatch(/^\s*const .*=\s*require\(/m);
  });
});

// The wiring half. Electron cannot be driven from vitest, so what is pinned
// here is the shape main.js must keep: the decisions stay in the module, and
// nothing but a quit may end the server process (which is what carries the
// background loops). The interactions themselves are on #94's smoke checklist.
describe("main.js wires the lifetime rules", () => {
  const main = read("electron-shell/main.js");
  const code = main
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  it("keeps the app alive when its last window is gone", () => {
    expect(code).toMatch(/app\.on\("window-all-closed"/);
    expect(code).toContain("keepsRunningWithoutWindow({");
  });

  it("asks the module what closing, starting, toggling and the tray menu mean", () => {
    expect(code).toContain("windowCloseAction({");
    expect(code).toContain("windowShowsOnStart({");
    expect(code).toContain("windowToggleAction({");
    expect(code).toContain("trayMenu({");
  });

  it("does not keep a second copy of the tray labels", () => {
    // One place decides both the wording and what the item does.
    expect(code).not.toMatch(/["'](显示窗口|隐藏窗口|重新加载)["']/);
  });

  it("ends the server process only on quit", () => {
    // Two call sites and no more: `will-quit`, and the reap for a child that
    // finished spawning after a quit had already started. A third one would be
    // a path that stops 定时任务 / RSS / 看板 / 频道 without anyone asking.
    expect(code.match(/stopServer\(\);/g)).toHaveLength(2);
  });
});
