export const TEST_BASE_URL =
  process.env.PI_WORK_TEST_BASE_URL ?? "http://localhost:30143";

export const TEST_PORT = Number(process.env.PI_WORK_TEST_PORT ?? 30143);
export const TEST_TERM_PORT = Number(process.env.PI_WORK_TEST_TERM_PORT ?? 30144);

export const ISOLATED_DATA_DIR =
  process.env.PI_WORK_DATA_DIR ?? "~/.pi-work-dev";
export const ISOLATED_AGENT_DIR =
  process.env.PI_CODING_AGENT_DIR ?? "~/.pi-dev/agent";

export const SERVER_BOOT_TIMEOUT_MS = 180_000;
