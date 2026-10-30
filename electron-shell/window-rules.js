const PROD_PORT = "30141";
const DEV_PORT = "30143";
const HOST = "127.0.0.1";
const OS_HANDLED_SCHEMES = new Set(["mailto:", "tel:"]);
const SHELL_COMMAND_SCHEME = "pi-work:";
const RETRY_COMMAND = "pi-work://retry";

function portOverride(env) {
  const raw = (env.PI_PORT ?? "").trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return String(port);
}

function resolveAppUrl({ dev, env = {} }) {
  const port = portOverride(env) ?? (dev ? DEV_PORT : PROD_PORT);
  return `http://${HOST}:${port}`;
}

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

function isShellCommand(url) {
  if (typeof url !== "string") return false;
  return url.startsWith(SHELL_COMMAND_SCHEME);
}

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
