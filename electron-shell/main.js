// main.js — Pi Work Electron shell
//
// The window loads Pi Work *directly*: the app is the top-level page, the
// window controls are the platform's own, and the shell owns exactly one page
// of its own — the "server unreachable" error page. There is no iframe, no
// self-drawn title bar and no preload bridge: all three existed only to embed
// the app inside a local file:// page.
//
// Scope: window + tray + global shortcut + single-instance + manual retry.
// Spawning and reaping the server process is a separate ticket (#88).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, shell } = require("electron");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveAppUrl, isExternalNavigation, isAppUrl } = require("./window-rules.js");

// ── Config ──────────────────────────────────────────────────────────
// `--dev` points the window at the isolated dev instance (port 30143, its own
// data root) instead of production, so debugging never touches production
// data. PI_PORT overrides either default — that is how the shell's own server
// spawner hands the window the port it picked.
const isDev = process.argv.includes("--dev");
const APP_URL = resolveAppUrl({ dev: isDev, env: process.env });
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_PORT = new URL(APP_URL).port;

// Windows: the app owns the title bar strip and the native caption buttons are
// drawn on top of it as a Window Controls Overlay — that keeps the Win11
// window controls and snap layouts while dropping the self-drawn title bar.
// Everywhere else the window keeps its ordinary native frame.
const USES_CONTROLS_OVERLAY = process.platform === "win32";
const CONTROLS_OVERLAY_HEIGHT = 36;
// The overlay is transparent so the app's own background shows through the
// strip; the glyphs are mid-gray, which reads on both the light and the dark
// app theme.
const CONTROLS_OVERLAY_COLOR = "#00000000";
const CONTROLS_OVERLAY_SYMBOL = "#808080";

// ── CLI flags ────────────────────────────────────────────────────────
const startHidden = process.argv.includes("--hidden");

// ── State ───────────────────────────────────────────────────────────
let win = null;
let tray = null;
let isQuitting = false;

// ── App icon ─────────────────────────────────────────────────────────
const iconPath = path.join(__dirname, "pi.png");

// ── Error page (shown when the Pi Work server is unreachable) ────────
// A data: URL rather than a file: the shell stays self-contained, and the
// retry button navigates the window itself — no preload/IPC needed.
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );
}

function errorPage(errorDescription) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Pi Work</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
display:flex;justify-content:center;align-items:center;height:100vh;
background:#0f0f1a;color:#c8c8d0}
/* Windows draws the caption buttons over a frameless window, so this page
   needs its own drag region — the app's one only exists once the app loads.
   Zero height (and therefore inert) when there is no overlay. */
.drag{position:fixed;inset:0 0 auto 0;height:env(titlebar-area-height, 0px);
-webkit-app-region:drag}
.container{text-align:center;max-width:440px;padding:0 24px}
h1{font-size:22px;font-weight:500;margin-bottom:12px;color:#e0e0e8}
p{font-size:14px;color:#787888;margin-bottom:6px}
.detail{font-size:12px;color:#5a5a68;word-break:break-all}
button{margin-top:16px;padding:10px 24px;font-size:15px;border:none;
border-radius:6px;background:#4a90d9;color:#fff;cursor:pointer}
button:hover{background:#3a7bc8}
</style></head><body><div class="drag"></div><div class="container">
<h1>Pi Work 服务未连接</h1>
<p>无法连接 ${escapeHtml(APP_URL)}</p>
<p>请确认 Pi Work 服务已启动（端口 ${escapeHtml(APP_PORT)}），然后重试。</p>
<p class="detail">${escapeHtml(errorDescription || "")}</p>
<button id="retry-btn">手动重试</button>
<script>
document.getElementById("retry-btn").addEventListener("click", function () {
  window.location.href = ${JSON.stringify(APP_URL)};
});
</script>
</div></body></html>`)}`;
}

/** Swap the window over to the error page. */
function showErrorPage(errorDescription) {
  if (!win) return;
  win.loadURL(errorPage(errorDescription)).catch(() => {});
}

/** Load the app. A failure surfaces through the did-fail-load handler. */
function loadApp() {
  if (!win) return;
  win.loadURL(APP_URL).catch(() => {});
}

/**
 * Reload the app in place — a normal reload keeps the current route and query,
 * so the user stays where they were. When the window is sitting on the error
 * page (a data: URL, not the app), go back to the app URL instead.
 */
function reloadApp() {
  if (!win) return;
  if (isAppUrl(win.webContents.getURL(), APP_ORIGIN)) {
    win.webContents.reload();
  } else {
    loadApp();
  }
}

// ── BrowserWindow ───────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: "Pi Work",
    autoHideMenuBar: true,
    show: !startHidden,
    icon: iconPath,
    ...(USES_CONTROLS_OVERLAY
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: CONTROLS_OVERLAY_COLOR,
            symbolColor: CONTROLS_OVERLAY_SYMBOL,
            height: CONTROLS_OVERLAY_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Every window.open()/target="_blank" link goes to the user's default
  // browser instead of spawning another Electron window. Non-web schemes
  // (ws://, javascript:, …) are dropped rather than fed to a shell handler.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalNavigation(url, APP_ORIGIN)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Backstop for links that navigate instead of popping: a plain <a href>
  // without target, or a location.href assignment, would otherwise replace
  // Pi Work in the window with the target page. Anything leaving the app goes
  // to the default browser; in-app navigation (route changes, the login
  // redirect) and the shell's own data: error page are left alone.
  win.webContents.on("will-frame-navigate", (event) => {
    const { url } = event;
    if (!isExternalNavigation(url, APP_ORIGIN)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  // Main-frame load failure → the server is unreachable (or went away): show
  // the retry page. ERR_ABORTED (-3) is our own navigation backstop, not a
  // failure; sub-frame failures are irrelevant now that nothing is embedded.
  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return; // ERR_ABORTED
      console.warn(
        `[Pi Shell] ${validatedURL} unreachable: ${errorDescription} (${errorCode})`
      );
      showErrorPage(errorDescription);
    }
  );

  // Ctrl+R / F5: reload the app in place. The custom menu below carries no
  // Reload role, so this is the only path for it.
  win.webContents.on("before-input-event", (event, input) => {
    const isReload =
      input.type === "keyDown" &&
      (input.key === "F5" ||
        (input.key.toLowerCase() === "r" && (input.control || input.meta)));
    if (isReload) {
      event.preventDefault();
      reloadApp();
      return;
    }
    if (
      input.type === "keyDown" &&
      (input.key === "F12" ||
        (input.control && input.shift && input.key.toLowerCase() === "i"))
    ) {
      win.webContents.toggleDevTools();
    }
  });

  console.log(
    `[Pi Shell] Loading ${APP_URL}${isDev ? " (isolated dev instance)" : ""}`
  );
  loadApp();

  // Hide to tray instead of closing
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    win = null;
  });
}

// ── System Tray ─────────────────────────────────────────────────────
function createTray() {
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip(isDev ? `Pi Work (dev · ${APP_PORT})` : "Pi Work");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        if (win) {
          win.show();
          win.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      // Also the recovery path when the window sits on the error page.
      label: "重新加载",
      click: () => {
        if (!win) {
          createWindow();
          return;
        }
        win.show();
        win.focus();
        console.log("[Pi Shell] Tray reload...");
        reloadApp();
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (win) {
      win.show();
      win.focus();
    } else {
      createWindow();
    }
  });
}

// ── App Lifecycle ───────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // Replace Electron's default application menu (which binds Ctrl+R / F5 to
  // its own "Reload" role and Ctrl+Shift+I to DevTools) with a minimal one
  // that keeps undo/copy/paste and quit working but leaves reload/devtools
  // wiring to main.js' before-input-event handler so we can intercept Ctrl+R.
  function installAppMenu() {
    const editMenu = {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { type: "separator" },
        { role: "selectAll", label: "全选" },
      ],
    };
    const fileMenu = {
      label: "文件",
      submenu: [{ role: "quit", label: "退出" }],
    };
    const template = [fileMenu];
    if (process.platform === "darwin") template.unshift({ label: app.name, role: "appMenu" });
    template.push(editMenu);
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  app.whenReady().then(() => {
    installAppMenu();
    createWindow();
    createTray();

    const registered = globalShortcut.register(
      "CommandOrControl+Shift+P",
      () => {
        if (win) {
          if (win.isVisible()) {
            win.hide();
          } else {
            win.show();
            win.focus();
          }
        }
      }
    );

    if (!registered) {
      console.warn(
        "[Pi Shell] Failed to register global shortcut Ctrl+Shift+P (may be taken by another app)"
      );
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
