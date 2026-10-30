const TRAY_ITEM = {
  TOGGLE_WINDOW: "toggle-window",
  RELOAD: "reload",
  QUIT: "quit",
};

const SEPARATOR = "separator";

function windowToggleAction({ windowVisible }) {
  return windowVisible ? "hide" : "show";
}

function windowCloseAction({ isQuitting, hasTray }) {
  if (isQuitting) return "close";
  return hasTray ? "hide" : "close";
}

function windowShowsOnStart({ launchHidden, hasStarted }) {
  return hasStarted ? true : !launchHidden;
}

function keepsRunningWithoutWindow({ isQuitting, hasTray }) {
  if (isQuitting) return false;
  return hasTray;
}

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
