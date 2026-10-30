// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, session, shell } = require("electron");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync, spawn } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RETRY_COMMAND, isAppUrl, isExternalNavigation, isShellCommand, resolveAppUrl } = require("./window-rules.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TRAY_ITEM, keepsRunningWithoutWindow, trayMenu, windowCloseAction, windowShowsOnStart, windowToggleAction } = require("./lifecycle.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AUTH_COOKIE_NAME, SESSION_TTL_MS, buildServerEnv, findFreePort, killPlan, mintSecret, shouldSpawnServer, serverCommand, signSessionToken, waitForServer } = require("./server-process.js");

const isDev = process.argv.includes("--dev");
const APP_ROOT = path.join(__dirname, "..");
const START_TIMEOUT_MS = 30_000;
const DETACHED = process.platform !== "win32";

let appUrl = resolveAppUrl({ dev: isDev, env: process.env });

const appOrigin = () => new URL(appUrl).origin;
const appPort = () => new URL(appUrl).port;

const USES_CONTROLS_OVERLAY = process.platform === "win32";
const CONTROLS_OVERLAY_HEIGHT = 36;
const CONTROLS_OVERLAY_COLOR = "#00000000";
const CONTROLS_OVERLAY_SYMBOL = "#808080";

const LAUNCH_HIDDEN = process.argv.includes("--hidden");

let win = null;
let tray = null;
let isQuitting = false;
let hasStarted = false;
let server = null;
let startInFlight = null;

const iconPath = path.join(__dirname, "pi.png");

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

function showErrorPage(errorDescription) {
  if (!win) return;
  win.loadURL(errorPage(errorDescription)).catch(() => {});
}

function loadApp() {
  if (!win) return;
  win.loadURL(appUrl).catch(() => {});
}

function reloadApp() {
  if (!win) return;
  if (isAppUrl(win.webContents.getURL(), appOrigin())) {
    win.webContents.reload();
  } else {
    loadApp();
  }
}

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
    if (!isQuitting && win) showErrorPage(`服务端已退出（code=${code ?? signal}）`);
  });

  if (isQuitting) {
    stopServer();
    return;
  }

  console.log(`[Pi Shell] server pid ${child.pid} listening on ${appUrl}`);
}

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
    return `无法写入会话凭据：${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

function startApp() {
  if (startInFlight) return startInFlight;
  startInFlight = (async () => {
    try {
      const failure = await ensureServer();
      if (isQuitting) return;
      if (!win) createWindow();
      if (failure) showErrorPage(failure);
      else {
        console.log(`[Pi Shell] loading ${appUrl}${isDev ? " (isolated dev instance)" : ""}`);
        loadApp();
      }
      if (tray) tray.setToolTip(trayTooltip());
      if (windowShowsOnStart({ launchHidden: LAUNCH_HIDDEN, hasStarted })) win.show();
      hasStarted = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Pi Shell] startup failed: ${message}`);
      if (win) showErrorPage(message);
    }
  })().finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}

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

function showWindow() {
  if (!win) {
    startApp();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) {
    startApp();
    return;
  }
  if (windowToggleAction({ windowVisible: win.isVisible() }) === "hide") win.hide();
  else showWindow();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: "Pi Work",
    autoHideMenuBar: true,
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalNavigation(url, appOrigin())) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-frame-navigate", (event) => {
    const { url } = event;
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

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (isShellCommand(validatedURL)) {
        startApp();
        return;
      }
      if (errorCode === -3) return;
      console.warn(
        `[Pi Shell] ${validatedURL} unreachable: ${errorDescription} (${errorCode})`
      );
      showErrorPage(errorDescription);
    }
  );

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

  win.on("close", (event) => {
    if (windowCloseAction({ isQuitting, hasTray: tray !== null }) === "hide") {
      event.preventDefault();
      win.hide();
    }
  });

  win.on("show", refreshTrayMenu);
  win.on("hide", refreshTrayMenu);

  win.on("closed", () => {
    win = null;
    refreshTrayMenu();
  });
}

function trayTooltip() {
  return isDev ? `Pi Work (dev · ${appPort()})` : `Pi Work (${appPort()})`;
}

function trayMenuItems() {
  return trayMenu({ windowVisible: Boolean(win?.isVisible()) }).map((item) => {
    if (item.type === "separator") return { type: "separator" };
    switch (item.id) {
      case TRAY_ITEM.TOGGLE_WINDOW:
        return { label: item.label, click: () => toggleWindow() };
      case TRAY_ITEM.RELOAD:
        return {
          label: item.label,
          click: () => {
            console.log("[Pi Shell] Tray reload...");
            showWindow();
            reloadApp();
          },
        };
      case TRAY_ITEM.QUIT:
        return {
          label: item.label,
          click: () => {
            console.log("[Pi Shell] Tray quit...");
            isQuitting = true;
            app.quit();
          },
        };
      default:
        throw new Error(`unknown tray item: ${item.id}`);
    }
  });
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuItems()));
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip(trayTooltip());
  refreshTrayMenu();

  tray.on("double-click", () => showWindow());
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

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
    try {
      createTray();
    } catch (err) {
      console.warn(
        `[Pi Shell] no tray icon: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    startApp();

    const registered = globalShortcut.register("CommandOrControl+Shift+P", () => toggleWindow());

    if (!registered) {
      console.warn(
        "[Pi Shell] Failed to register global shortcut Ctrl+Shift+P (may be taken by another app)"
      );
    }
  });

  app.on("window-all-closed", () => {
    if (keepsRunningWithoutWindow({ isQuitting, hasTray: tray !== null })) return;
    app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    stopServer();
    globalShortcut.unregisterAll();
  });
}
