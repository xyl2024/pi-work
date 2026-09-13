/**
 * Shared test constants.
 *
 * Interface tests target the *isolated* Pi Work instance (the one started by
 * `npm run dev:isolated`, port 30143, data root ~/.pi-work-dev) — never the
 * production instance on 30141. They probe the URL first and auto-start the
 * isolated instance when nothing answers (see tests/global-setup.ts).
 *
 * Tests always run against `next dev` on the isolated instance; there is no
 * production-shaped run, and a production instance is never a test target.
 *
 * Override via PI_WORK_TEST_* env vars when needed.
 */

export const TEST_BASE_URL =
  process.env.PI_WORK_TEST_BASE_URL ?? "http://localhost:30143";

export const TEST_PORT = Number(process.env.PI_WORK_TEST_PORT ?? 30143);
export const TEST_TERM_PORT = Number(process.env.PI_WORK_TEST_TERM_PORT ?? 30144);

/** Same isolation layout as scripts/dev-isolated.mjs. */
export const ISOLATED_DATA_DIR =
  process.env.PI_WORK_DATA_DIR ?? "~/.pi-work-dev";
export const ISOLATED_AGENT_DIR =
  process.env.PI_CODING_AGENT_DIR ?? "~/.pi-dev/agent";

/** How long global-setup waits for the server to answer (ms). */
export const SERVER_BOOT_TIMEOUT_MS = 180_000;
