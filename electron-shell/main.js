// main.js — Pi Work Electron shell
//
// The shell owns a server process. A plain (packaged) launch starts one: a
// standalone Node runtime bundled under `resources/runtime/` runs the
// production server (`bin/pi-work.js`) on a random loopback port, with a
// per-launch random secret; the window is signed in with the matching cookie
// before the app loads. `--dev` still points at the isolated dev instance and
// an explicit `PI_PORT` still means "a server is already running here", so in
// those two cases the shell spawns nothing.
//
// The window loads Pi Work *directly*: the app is the top-level page, the
// window controls are the platform's own, and the shell owns exactly one page
// of its own — the "server unreachable" error page. There is no iframe, no
// self-drawn title bar and no preload bridge: the error page's retry button is
// a navigation to `pi-work://retry`, which this process cancels and turns into
// a restart.
//
// The server-process decisions (whether to spawn, with what command and env,
// how to sign the session, how to kill the tree, when it counts as ready) live
// in server-process.js, which is unit-tested without Electron.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, session, shell } = require("electron");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync, spawn } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RETRY_COMMAND, isAppUrl, isExternalNavigation, isShellCommand, resolveAppUrl } = require("./window-rules.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AUTH_COOKIE_NAME, SESSION_TTL_MS, buildServerEnv, findFreePort, killPlan, mintSecret, shouldSpawnServer, serverCommand, signSessionToken, waitForServer } = require("./server-process.js");

// ── Config ──────────────────────────────────────────────────────────
// `--dev` points the window at the isolated dev instance (port 30143, its own
// data root) instead of production, so debugging never touches production
// data. PI_PORT means "a server is already running on this port" — that is the
// documented way to attach the shell to a server someone else started.
const isDev = process.argv.includes("--dev");
/** The pi-work root: `bin/pi-work.js` and `.next/` live here. */
const APP_ROOT = path.join(__dirname, "..");
/** How long a launch waits for the server before showing the error page. */
const START_TIMEOUT_MS = 30_000;
/** POSIX: own a process group so `killPlan` can take the whole tree down. */
const DETACHED = process.platform !== "win32";

// The URL the window loads. Replaced by the real port once the shell's own
// server has picked one (see startServer); until then it is the dev / already
// running instance the window is pointed at.
let appUrl = resolveAppUrl({ dev: isDev, env: process.env });

const appOrigin = () => new URL(appUrl).origin;
const appPort = () => new URL(appUrl).port;

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
/** The server this launch owns; null when it does not own one (dev, PI_PORT). */
let server = null;
/** In-flight start/retry, so a double-clicked retry cannot spawn twice. */
let startInFlight = null;

// ── App icon ─────────────────────────────────────────────────────────
const iconPath = path.join(__dirname, "pi.png");

// ── Error page (shown when the Pi Work server is unreachable) ────────
// A data: URL rather than a file: the shell stays self-contained. The retry
// button navigates to the shell's own `pi-work://retry` command, which the
// main process turns into "make sure the server is up, then load the app" —
// that is the whole IPC surface, so no preload bridge is needed.
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
<p>无法连接 ${escapeHtml(appUrl)}</p>
<p>请确认 Pi Work 服务已启动（端口 ${escapeHtml(appPort())}），然后重试。</p>
<p class="detail">${escapeHtml(errorDescription || "")}</p>
<button id="retry-btn">手动重试</button>
<script>
document.getElementById("retry-btn").addEventListener("click", function () {
  window.location.href = ${JSON.stringify(RETRY_COMMAND)};
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
  win.loadURL(appUrl).catch(() => {});
}

/**
 * Reload the app in place — a normal reload keeps the current route and query,
 * so the user stays where they were. When the window is sitting on the error
 * page (a data: URL, not the app), go back to the app URL instead.
 */
function reloadApp() {
  if (!win) return;
  if (isAppUrl(win.webContents.getURL(), appOrigin())) {
    win.webContents.reload();
  } else {
    loadApp();
  }
}

// ── The server process ───────────────────────────────────────────────
/**
 * Start the server this launch owns: a standalone Node runtime on a random
 * loopback port, with a fresh secret. Resolves once the process has spawned
 * (not once it answers — see ensureServer).
 */
async function startServer() {
  const secret = mintSecret();
  const port = await findFreePort();
  const terminalPort = await findFreePort();
  const plan = serverCommand({
    appRoot: APP_ROOT,
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    env: process.env,
    port,
  });
  if (!plan.ok) throw new Error(plan.reason);

  const child = await new Promise((resolve, reject) => {
    const proc = spawn(plan.command, plan.args, {
      cwd: APP_ROOT,
      // The desktop track's env: PI_WORK_DESKTOP + this launch's secret + the
      // ports it picked. Never Electron's own Node (see server-process.js).
      env: buildServerEnv({ env: process.env, port, terminalPort, secret }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: DETACHED,
    });
    proc.once("spawn", () => resolve(proc));
    proc.once("error", reject);
  });

  server = {
    child,
    port,
    secret,
    kill: killPlan({ pid: child.pid, platform: process.platform, detached: DETACHED }),
  };
  appUrl = `http://127.0.0.1:${port}`;

  const mirror = (stream) => (chunk) => process[stream].write(`[Pi Shell] server ${chunk}`);
  if (child.stdout) child.stdout.on("data", mirror("stdout"));
  if (child.stderr) child.stderr.on("data", mirror("stderr"));
  child.on("error", (err) => console.warn(`[Pi Shell] server error: ${err.message}`));
  child.on("exit", (code, signal) => {
    console.warn(`[Pi Shell] server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    server = null;
    // A server that dies under a live window fails every request from then on:
    // show the retry page instead of a UI that silently stopped working.
    if (!isQuitting && win) showErrorPage(`服务端已退出（code=${code ?? signal}）`);
  });

  console.log(`[Pi Shell] server pid ${child.pid} listening on ${appUrl}`);
}

/** Sign the window in: the cookie the server derives its key from. */
async function injectAuthCookie() {
  await session.defaultSession.cookies.set({
    url: `http://127.0.0.1:${server.port}`,
    name: AUTH_COOKIE_NAME,
    value: signSessionToken({ secret: server.secret }),
    httpOnly: true,
    sameSite: "lax",
    expirationDate: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
  });
  console.log("[Pi Shell] session cookie injected");
}

/**
 * Make sure something answers on the app URL: start the server if this launch
 * owns one and wait for it. Returns a failure message for the error page, or
 * null when the window can load.
 *
 * Dev mode and an explicit PI_PORT return straight away — in those cases the
 * server is someone else's and the login page (not a shell-signed cookie) is
 * how the window authorizes itself.
 */
async function ensureServer() {
  if (!shouldSpawnServer({ dev: isDev, env: process.env })) return null;

  if (!server) {
    try {
      await startServer();
    } catch (err) {
      return `服务端启动失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const child = server?.child;
  if (!child) {
    // It exited between spawning and here: the exit handler already cleared
    // the slot (and showed its own message).
    return "服务端已退出";
  }
  const ready = await waitForServer({
    url: appUrl,
    timeoutMs: START_TIMEOUT_MS,
    shouldAbort: () => child.exitCode !== null || child.signalCode !== null,
  });
  if (!ready) {
    return server
      ? `服务端在 ${START_TIMEOUT_MS / 1000} 秒内没有就绪（${appUrl}）`
      : "服务端已退出";
  }
  try {
    await injectAuthCookie();
  } catch (err) {
    // The cookie *is* the trust boundary here: without it every request is
    // 401, so failing loudly beats an app that loads and does nothing.
    return `无法写入会话凭据：${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

/**
 * Bring the app up: make sure the server is there, create the window if
 * needed, then load the app (or the error page). Also what the error page's
 * retry button does, so retrying with a live server is just a reload.
 *
 * The window is created hidden and shown at the end: a window announcing
 * "服务端未连接" while the server is still starting would be a lie.
 */
function startApp() {
  if (startInFlight) return startInFlight;
  startInFlight = (async () => {
    try {
      const failure = await ensureServer();
      if (!win) createWindow();
      if (failure) showErrorPage(failure);
      else {
        console.log(`[Pi Shell] loading ${appUrl}${isDev ? " (isolated dev instance)" : ""}`);
        loadApp();
      }
      if (tray) tray.setToolTip(trayTooltip());
      if (!startHidden) win.show();
    } catch (err) {
      // Nothing here may reject silently: startApp is fired and forgotten by
      // the tray, the retry command and app-ready alike.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Pi Shell] startup failed: ${message}`);
      if (win) showErrorPage(message);
    }
  })().finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}

/**
 * End the server process tree, so quitting leaves nothing behind.
 *
 * Windows' `taskkill` runs synchronously: the shell is on its way out, and an
 * asynchronous killer could be lost when the process goes away. POSIX signals
 * the whole group and lets the entry's own shutdown finish the tree (it
 * escalates to SIGKILL itself) — the signal is delivered before we return.
 */
function stopServer() {
  if (!server) return;
  const { child, kill } = server;
  server = null;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (kill.method === "command") {
      execFileSync(kill.command, kill.args, { stdio: "ignore" });
    } else {
      process.kill(kill.pid, kill.signal);
    }
    console.log(`[Pi Shell] stopping server pid ${child.pid}`);
  } catch (err) {
    console.warn(`[Pi Shell] could not stop server pid ${child.pid}: ${err.message}`);
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
    // Shown by startApp once the app (or the error page) is in place.
    show: false,
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
    if (isExternalNavigation(url, appOrigin())) shell.openExternal(url);
    return { action: "deny" };
  });

  // Backstop for links that navigate instead of popping: a plain <a href>
  // without target, or a location.href assignment, would otherwise replace
  // Pi Work in the window with the target page. Anything leaving the app goes
  // to the default browser; in-app navigation (route changes, the login
  // redirect) and the shell's own data: error page are left alone.
  win.webContents.on("will-frame-navigate", (event) => {
    const { url } = event;
    // The error page's retry button: cancel the (undeliverable) navigation and
    // run the command here instead.
    if (isShellCommand(url)) {
      event.preventDefault();
      console.log("[Pi Shell] retry requested");
      startApp();
      return;
    }
    if (!isExternalNavigation(url, appOrigin())) return;
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
      // The retry command arrives through whichever handler Chromium runs
      // first: `will-frame-navigate` above cancels it, or — if the unknown
      // scheme never got that far — this failure is how we hear about it.
      // startApp() is idempotent while one is in flight, so both are harmless.
      if (isShellCommand(validatedURL)) {
        startApp();
        return;
      }
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
function trayTooltip() {
  return isDev ? `Pi Work (dev · ${appPort()})` : `Pi Work (${appPort()})`;
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip(trayTooltip());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        if (!win) {
          startApp();
          return;
        }
        win.show();
        win.focus();
      },
    },
    {
      // Also the recovery path when the window sits on the error page.
      label: "重新加载",
      click: () => {
        if (!win) {
          startApp();
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
    if (!win) {
      startApp();
      return;
    }
    win.show();
    win.focus();
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
    createTray();
    startApp();

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
    stopServer();
    globalShortcut.unregisterAll();
  });
}
