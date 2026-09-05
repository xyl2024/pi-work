/**
 * Shared test constants.
 *
 * Both test layers target the *isolated* Pi Work instance (the one started by
 * `npm run dev:isolated`, port 30143, data root ~/.pi-work-dev) — never the
 * production instance on 30141:
 *
 *   - UI tests (Playwright) require the instance to be running already
 *     (see playwright.config.ts);
 *   - interface tests (Vitest) probe the URL first and auto-start the isolated
 *     instance when nothing answers (see tests/global-setup.ts).
 *
 * Interface tests run against `next dev` by default; set PI_WORK_TEST_PROD=1
 * to build and test against a production server (`next build` + `next start`)
 * with the same isolated data root.
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

/** Run the server in production mode (`next build` + `next start`). */
export const PROD_MODE = process.env.PI_WORK_TEST_PROD === "1";

/** How long global-setup waits for the server to answer (ms). */
export const SERVER_BOOT_TIMEOUT_MS = 180_000;
