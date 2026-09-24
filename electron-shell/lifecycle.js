// lifecycle.js — the window's visibility and the app's lifetime are two
// different things.
//
// The background loops (定时任务 / RSS / 看板 / 频道) run inside the server
// process, and the shell owns that process rather than the window: closing the
// window hides it, the server keeps running, and only the tray's 「退出」 ends
// the process tree (#89). The decisions behind that story — what the close
// button does, which way a toggle goes, whether a start shows the window,
// whether the app outlives it, and what the tray menu offers — live here rather
// than in main.js, so they can be driven and read without Electron.
//
// The tray menu is derived from the same rules, so its wording and what its
// items do cannot disagree about which way the toggle goes.
//
// Electron cannot be driven from vitest, so every decision of that story is
// here with its inputs as explicit arguments (`hasTray` / `isQuitting` /
// `windowVisible` / `launchHidden` / `hasStarted`), and main.js only maps the
// results onto Electron calls. This module reads neither `process.platform`
// nor `process.env` and imports nothing — same shape as window-rules.js and
// server-process.js (ADR-0003 rule 3). It is plain CommonJS: the Electron main
// process loads it with no bundler and no path aliases, and
// tests/unit/electron-shell-lifecycle.test.ts imports it as-is.

/** Menu item ids; main.js maps each one to the Electron call it stands for. */
const TRAY_ITEM = {
  TOGGLE_WINDOW: "toggle-window",
  RELOAD: "reload",
  QUIT: "quit",
};

/** Item type that is a divider rather than an action. */
const SEPARATOR = "separator";

/**
 * What a show/hide toggle does to the window right now. One rule for every
 * place that toggles: the tray's item and the global shortcut.
 */
function windowToggleAction({ windowVisible }) {
  return windowVisible ? "hide" : "show";
}

/**
 * What the window's close button (X) does: hide into the tray, or really close.
 *
 * A quit in progress must be allowed to close — preventing that close cancels
 * the quit, and with it the `will-quit` that reaps the server. Without a tray
 * icon there is no way back to a hidden window, so hiding would leave the app
 * running with no UI at all; closing (which ends the server too) is the honest
 * outcome of a shell that cannot show its window again.
 */
function windowCloseAction({ isQuitting, hasTray }) {
  if (isQuitting) return "close";
  return hasTray ? "hide" : "close";
}

/**
 * Whether this start shows the window.
 *
 * Only the very first start of a `--hidden` (autostart) launch stays hidden.
 * Every later one is someone asking for the window — the tray's toggle, a
 * second launch, the error page's retry — and hiding it again would look like
 * a click that did nothing.
 */
function windowShowsOnStart({ launchHidden, hasStarted }) {
  return hasStarted ? true : !launchHidden;
}

/**
 * Whether the app stays alive once no window is left — the `window-all-closed`
 * decision. A quit already owns the shutdown, so nothing may keep the app alive
 * past it; otherwise the tray decides, because the server process (and the
 * loops ticking inside it) must not be taken down just because a window went
 * away.
 */
function keepsRunningWithoutWindow({ isQuitting, hasTray }) {
  if (isQuitting) return false;
  return hasTray;
}

/**
 * The tray's menu, from what the window is doing now. The toggle item's label
 * is derived from `windowToggleAction`, so it always announces the direction
 * the click will take. Reload stays in both states: it is the recovery path
 * when the window sits on the shell's "服务未连接" page.
 *
 * @returns {Array<{id?: string, label?: string, type?: string}>}
 */
function trayMenu({ windowVisible }) {
  return [
    {
      id: TRAY_ITEM.TOGGLE_WINDOW,
      label: windowToggleAction({ windowVisible }) === "hide" ? "隐藏窗口" : "显示窗口",
    },
    { id: TRAY_ITEM.RELOAD, label: "重新加载" },
    { type: SEPARATOR },
    { id: TRAY_ITEM.QUIT, label: "退出" },
  ];
}

module.exports = {
  TRAY_ITEM,
  keepsRunningWithoutWindow,
  trayMenu,
  windowCloseAction,
  windowShowsOnStart,
  windowToggleAction,
};
