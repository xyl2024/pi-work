/**
 * Build the environment for child processes started by Pi Work.
 *
 * The Next.js process must keep its own environment (notably NODE_ENV and
 * PORT). Only child processes should be detached from Pi Work's server
 * bookkeeping variables. User/project variables are intentionally preserved
 * because tools such as AWS, Go, Python, Java and npm commonly depend on them.
 */

export const ALLOWED_ENV_NAMES: ReadonlySet<string> = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TZ", "TERM",
  "VIRTUAL_ENV", "JAVA_HOME", "GOPATH", "CARGO_HOME", "AWS_PROFILE",
]);

const STRIPPED_NAMES = new Set([
  "NODE_ENV",
  "PORT",
  "HOSTNAME",
  "NEXT_RUNTIME",
  "__NEXT_PRIVATE_ORIGIN",
  "NEXT_DEPLOYMENT_ID",
  "NEXT_PRIVATE_START_TIME",
  "BEYOND_TOKEN",
  "KN_MANAGER_URL",
  "WORKFLOW_APP_ID",
]);

const STRIPPED_PREFIXES = [
  "NEXT_",
  "__NEXT_",
  "PI_WORK_",
];

function shouldStrip(key: string): boolean {
  return STRIPPED_NAMES.has(key) || STRIPPED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Return a fresh environment object; never mutates `source` or process.env. */
export function sanitizeChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && !shouldStrip(key)) out[key] = value;
  }
  return out as NodeJS.ProcessEnv;
}

/** Exported for focused tests and callers that need to inspect the policy. */
export function shouldKeep(key: string): boolean {
  return !shouldStrip(key);
}

export const EXPLICITLY_STRIPPED_NAMES = STRIPPED_NAMES;
export const EXPLICITLY_STRIPPED_PREFIXES = STRIPPED_PREFIXES;
