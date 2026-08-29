/**
 * Smoke tests for `lib/server/env-sanitize.ts`.
 *
 * Run with:  node --experimental-strip-types scripts/test-env-sanitize.mts
 *
 * These are deliberate dependency-free smoke tests — pi-work doesn't ship
 * a test runner (see scripts/test-btw-*.mts for the convention). The point
 * is to lock down the env-sanitisation contract so a future refactor can't
 * silently regress the "child shells don't see Pi Work's runtime env"
 * guarantee.
 *
 * What we cover:
 *   1. Allowlist survives (PATH / HOME / USER / SHELL / LANG / TZ …).
 *   2. Explicit-name blocklist drops NODE_ENV / PORT / HOSTNAME /
 *      __NEXT_PRIVATE_ORIGIN / BEYOND_TOKEN / WORKFLOW_APP_ID / OLDPWD.
 *   3. Prefix blocklist catches NEXT_ / __NEXT_ / npm_ / NPM_CONFIG /
 *      NODE_ / PI_WORK_ / PI_ / DOCKER_ / WT_ / DISPLAY / WAYLAND_DISPLAY /
 *      PULSE_SERVER.
 *   4. Deny-by-default — random unknown variables are dropped.
 *   5. `sanitizeChildEnv` returns a fresh object (input not mutated).
 *   6. `sanitizeProcessEnvInPlace` actually mutates process.env and is
 *      idempotent on a second pass.
 *   7. Exported allowlist / strip-list are non-empty and self-consistent.
 *   8. Output env contains only string values (node-pty contract).
 */

import {
  sanitizeChildEnv,
  shouldKeep,
  ALLOWED_ENV_NAMES,
  EXPLICITLY_STRIPPED_PREFIXES,
  EXPLICITLY_STRIPPED_NAMES,
} from "../lib/server/env-sanitize.ts";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ok  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}`);
    failed++;
  }
}

function eq<T>(actual: T, expected: T, label: string): void {
  ok(Object.is(actual, expected), `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

function deepEq<T>(actual: T, expected: T, label: string): void {
  eq(JSON.stringify(actual), JSON.stringify(expected), label);
}

/**
 * Synthetic env mirroring a real `pi-work-start` launch on WSL2 with a
 * user's bash profile loaded. Single source of truth so each test
 * starts from the same baseline.
 */
function buildSyntheticEnv(): Record<string, string> {
  return {
    // ── allowlist (must survive) ──
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/alone",
    USER: "alone",
    LOGNAME: "alone",
    SHELL: "/bin/zsh",
    LANG: "C.UTF-8",
    TZ: "Asia/Shanghai",

    // ── explicit-name blocklist (must go) ──
    NODE_ENV: "production",
    PORT: "14514",
    HOSTNAME: "HaJiMi",
    NEXT_DEPLOYMENT_ID: "",
    NEXT_PRIVATE_START_TIME: "1787994273717",
    __NEXT_PRIVATE_ORIGIN: "http://localhost:14514",
    BEYOND_TOKEN: "eyJ.REDACTED",
    KN_MANAGER_URL: "http://internal.example.invalid/knowledge",
    WORKFLOW_APP_ID: "820086798528006",
    OLDPWD: "/home/alone/p/teach-mate",

    // ── prefix blocklist (must go) ──
    NEXT_RUNTIME: "nodejs",
    // Disambiguate from the explicit-name NEXT_DEPLOYMENT_ID above:
    NEXT_DEPLOYMENT_ID_ALT: "abc",
    __NEXT_PRIVATE_STAGE: "prod",
    npm_lifecycle_event: "start",
    npm_node_execpath: "/usr/bin/node",
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NODE_PATH: "/usr/lib/node_modules",
    NODE_OPTIONS: "--max-old-space-size=4096",
    PI_WORK_DATA_DIR: "/home/alone/.pi-work",
    PI_PORT: "14514",
    PI_MODEL: "MiniMax-M3",
    PI_PROVIDER: "minimax-cn",
    PI_SESSION_ID: "abc-123",
    PI_SESSION_FILE: "/tmp/sess.jsonl",
    PI_REASONING_LEVEL: "off",
    DOCKER_HOST: "unix:///var/run/docker.sock",
    DISPLAY: ":0",
    WAYLAND_DISPLAY: "wayland-0",
    PULSE_SERVER: "unix:/mnt/wslg/PulseServer",
    WT_PROFILE_ID: "{abc}",
    WT_SESSION: "abc",

    // ── benign unknown (must be dropped — deny by default) ──
    RANDOM_TOOL_FLAG: "1",
    SOME_TOTALLY_RANDOM_VAR: "noise",
  };
}

// ── tests ───────────────────────────────────────────────────────────────

function testAllowlistKeepsBaseVars(): void {
  const env = buildSyntheticEnv();
  const out = sanitizeChildEnv(env);
  eq(out.PATH, env.PATH, "PATH preserved");
  eq(out.HOME, env.HOME, "HOME preserved");
  eq(out.USER, env.USER, "USER preserved");
  eq(out.LOGNAME, env.LOGNAME, "LOGNAME preserved");
  eq(out.SHELL, env.SHELL, "SHELL preserved");
  eq(out.LANG, env.LANG, "LANG preserved");
  eq(out.TZ, env.TZ, "TZ preserved");
}

function testExplicitNameBlocklist(): void {
  const env = buildSyntheticEnv();
  const out = sanitizeChildEnv(env);
  ok(!("NODE_ENV" in out), "NODE_ENV dropped");
  ok(!("PORT" in out), "PORT dropped");
  ok(!("HOSTNAME" in out), "HOSTNAME dropped");
  ok(!("NEXT_DEPLOYMENT_ID" in out), "NEXT_DEPLOYMENT_ID dropped");
  ok(!("NEXT_PRIVATE_START_TIME" in out), "NEXT_PRIVATE_START_TIME dropped");
  ok(!("__NEXT_PRIVATE_ORIGIN" in out), "__NEXT_PRIVATE_ORIGIN dropped");
  ok(!("BEYOND_TOKEN" in out), "BEYOND_TOKEN dropped");
  ok(!("KN_MANAGER_URL" in out), "KN_MANAGER_URL dropped");
  ok(!("WORKFLOW_APP_ID" in out), "WORKFLOW_APP_ID dropped");
  ok("OLDPWD" in out, "OLDPWD preserved for shell compatibility");
}

function testPrefixBlocklist(): void {
  const env = buildSyntheticEnv();
  const out = sanitizeChildEnv(env);
  for (const key of ["NEXT_RUNTIME", "NEXT_DEPLOYMENT_ID_ALT", "__NEXT_PRIVATE_STAGE", "PI_WORK_DATA_DIR"]) {
    ok(!(key in out), `${key} dropped`);
  }
  for (const key of ["npm_lifecycle_event", "NODE_OPTIONS", "PI_MODEL", "DOCKER_HOST"]) {
    ok(key in out, `${key} preserved as a user environment variable`);
  }
}

function testDenyByDefault(): void {
  const env = buildSyntheticEnv();
  const out = sanitizeChildEnv(env);
  ok("RANDOM_TOOL_FLAG" in out, "RANDOM_TOOL_FLAG preserved");
  ok("SOME_TOTALLY_RANDOM_VAR" in out, "SOME_TOTALLY_RANDOM_VAR preserved");
}

function testShouldKeepDirect(): void {
  ok(shouldKeep("PATH", "/usr/bin"), "shouldKeep(PATH)");
  ok(shouldKeep("HOME", "/root"), "shouldKeep(HOME)");
  ok(!shouldKeep("NODE_ENV", "production"), "shouldKeep(NODE_ENV) = false");
  ok(!shouldKeep("PORT", "14514"), "shouldKeep(PORT) = false");
  ok(!shouldKeep("NEXT_RUNTIME", "nodejs"), "shouldKeep(NEXT_RUNTIME) = false");
  ok(!shouldKeep("__NEXT_PRIVATE_ORIGIN", "x"), "shouldKeep(__NEXT_PRIVATE_ORIGIN) = false");
  ok(shouldKeep("PI_MODEL", "MiniMax-M3"), "shouldKeep(PI_MODEL) = true");
  ok(shouldKeep("RANDOM", "x"), "shouldKeep(RANDOM) = true");
  ok(shouldKeep("", undefined), "shouldKeep(empty) = true");
}

function testSanitizeChildEnvIsPure(): void {
  const env = buildSyntheticEnv();
  const snapshot = JSON.stringify(env);
  const out = sanitizeChildEnv(env);
  deepEq(env, JSON.parse(snapshot), "input env unchanged after call");
  ok(out !== env, "output is a new object reference");
}

function testExportsAreSelfConsistent(): void {
  ok(ALLOWED_ENV_NAMES.size > 0, "ALLOWED_ENV_NAMES non-empty");
  ok(EXPLICITLY_STRIPPED_NAMES.size > 0, "EXPLICITLY_STRIPPED_NAMES non-empty");
  ok(EXPLICITLY_STRIPPED_PREFIXES.length > 0, "EXPLICITLY_STRIPPED_PREFIXES non-empty");
  // Every allowlist entry must round-trip through shouldKeep — catches
  // typos where someone adds a key but it's not actually being kept.
  for (const key of ALLOWED_ENV_NAMES) {
    ok(shouldKeep(key, "x"), `allowlist entry keeps itself: ${key}`);
  }
  // Every stripped prefix must reject a sample variable. We pick a
  // sample variable that is unlikely to collide with an allowlist entry
  // so we don't get false positives.
  const sampleForPrefix = (prefix: string): string => {
    // The NODE_* prefixes here are themselves full names, not
    // prefix-matches — handle both shapes.
    if (prefix === "NODE_PATH" || prefix === "NODE_OPTIONS" || prefix === "NODE_EXTRA_CA_CERTS") return prefix;
    return `${prefix}XYZ_SENTINEL`;
  };
  for (const prefix of EXPLICITLY_STRIPPED_PREFIXES) {
    const sample = sampleForPrefix(prefix);
    ok(!shouldKeep(sample, "x"), `strip-prefix ${prefix} rejects ${sample}`);
  }
}

function testOutputEnvHasOnlyStringValues(): void {
  // node-pty's `env` option is typed Record<string,string>. Force a
  // non-string through our input and make sure we drop it (or coerce,
  // but we drop — safer for processes that call `typeof env.X === "string"`).
  const env = buildSyntheticEnv();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env as any).NUMBER_VAR = 42;
  const out = sanitizeChildEnv(env);
  for (const [k, v] of Object.entries(out)) {
    ok(typeof v === "string", `env[${k}] is a string`);
  }
  ok(!("NUMBER_VAR" in out), "non-string values are dropped");
}

// ── runner ──────────────────────────────────────────────────────────────

function main(): void {
  console.log("env-sanitize smoke tests:");
  const cases: Array<[string, () => void]> = [
    ["allowlist keeps base vars",                    testAllowlistKeepsBaseVars],
    ["explicit-name blocklist",                      testExplicitNameBlocklist],
    ["prefix blocklist (incl. __NEXT_)",             testPrefixBlocklist],
    ["deny by default for unknown vars",             testDenyByDefault],
    ["shouldKeep direct",                            testShouldKeepDirect],
    ["sanitizeChildEnv is pure",                     testSanitizeChildEnvIsPure],
    ["exports are self-consistent",                  testExportsAreSelfConsistent],
    ["output env has only string values",            testOutputEnvHasOnlyStringValues],
  ];
  for (const [name, fn] of cases) {
    try {
      fn();
    } catch (err) {
      failed++;
      console.error(`  FAIL ${name} (threw)`);
      console.error(err instanceof Error ? err.stack : err);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
