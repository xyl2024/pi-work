import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

const tmpDir = mkdtempSync(join(tmpdir(), "agent-settings-test-"));
const testSettingsPath = join(tmpDir, "settings.json");
process.env.PI_CODING_AGENT_DIR = tmpDir;

const realSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
const realSettingsMtimeBefore = existsSync(realSettingsPath)
  ? statSync(realSettingsPath).mtimeMs
  : null;
const realSettingsContentBeforeSnapshot: string | null =
  realSettingsMtimeBefore !== null
    ? readFileSync(realSettingsPath, "utf8")
    : null;

import {
  DEFAULT_AGENT_RETRY,
  readAgentRetry,
  resetAgentRetry,
  writeAgentRetry,
} from "@/lib/server/agent-settings";

let pass = 0;
let fail = 0;

function ok(label: string) {
  pass++;
  console.log(`  \u2713 ${label}`);
}

function fail_(label: string, detail?: unknown) {
  fail++;
  console.error(`  \u2717 ${label}`);
  if (detail !== undefined) console.error("    detail:", detail);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(label);
  else fail_(label, { expected: e, actual: a });
}

function assertTrue(cond: unknown, label: string) {
  if (cond) ok(label);
  else fail_(label);
}

function assertFalse(cond: unknown, label: string) {
  if (!cond) ok(label);
  else fail_(label);
}

function section(title: string) {
  console.log(`\n── ${title} ──`);
}

function writeRaw(content: string) {
  writeFileSync(testSettingsPath, content, "utf8");
}

function readRaw(): string {
  return readFileSync(testSettingsPath, "utf8");
}

function listTmp(): string[] {
  if (!existsSync(tmpDir)) return [];
  return readdirSync(tmpDir).filter(
    (f) => f.includes(".tmp.") || f.includes(".bak."),
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  section("1. read with no settings.json");
  if (existsSync(testSettingsPath)) rmSync(testSettingsPath);
  assertEqual(await readAgentRetry(), DEFAULT_AGENT_RETRY, "returns defaults");
  assertFalse(existsSync(testSettingsPath), "read does not create the file");

  section("2. read with empty file");
  writeRaw("");
  assertEqual(await readAgentRetry(), DEFAULT_AGENT_RETRY, "returns defaults");
  assertTrue(existsSync(testSettingsPath), "empty file left untouched");

  section("3. read with malformed json");
  const malformed = "{ this is not json";
  writeRaw(malformed);
  assertEqual(await readAgentRetry(), DEFAULT_AGENT_RETRY, "returns defaults");
  assertEqual(readRaw(), malformed, "malformed file is left untouched");

  section("4. read with valid json, no retry key");
  const noRetry = JSON.stringify({
    lastChangelogVersion: "0.78.1",
    defaultProvider: "minimax-cn",
    defaultModel: "MiniMax-M3",
    theme: "dark",
    skills: ["+foo", "-bar"],
  });
  writeRaw(noRetry);
  assertEqual(await readAgentRetry(), DEFAULT_AGENT_RETRY, "returns defaults");
  assertEqual(readRaw(), noRetry, "file is left untouched");

  section("5. read with full retry block");
  const fullRetry = JSON.stringify({
    defaultProvider: "minimax-cn",
    defaultModel: "MiniMax-M3",
    theme: "dark",
    retry: {
      enabled: false,
      maxRetries: 5,
      baseDelayMs: 1000,
      provider: {
        timeoutMs: 30000,
        maxRetries: 2,
        maxRetryDelayMs: 45000,
      },
    },
  });
  writeRaw(fullRetry);
  assertEqual(
    await readAgentRetry(),
    {
      enabled: false,
      maxRetries: 5,
      baseDelayMs: 1000,
      provider: {
        timeoutMs: 30000,
        maxRetries: 2,
        maxRetryDelayMs: 45000,
      },
    },
    "returns the full retry block verbatim",
  );

  section("6. read with partial retry (only provider.maxRetries)");
  const partialRetry = JSON.stringify({
    retry: {
      enabled: false,
      maxRetries: 7,
      baseDelayMs: 500,
      provider: { maxRetries: 3 },
    },
  });
  writeRaw(partialRetry);
  const parsedPartial = await readAgentRetry();
  assertEqual(parsedPartial.enabled, false, "enabled preserved");
  assertEqual(parsedPartial.maxRetries, 7, "maxRetries preserved");
  assertEqual(parsedPartial.baseDelayMs, 500, "baseDelayMs preserved");
  assertTrue(parsedPartial.provider.maxRetries === 3, "provider.maxRetries preserved");
  assertTrue(parsedPartial.provider.timeoutMs === undefined, "provider.timeoutMs falls back to undefined");
  assertTrue(parsedPartial.provider.maxRetryDelayMs === undefined, "provider.maxRetryDelayMs falls back to undefined");

  section("7. read with malformed retry block (wrong types)");
  writeRaw(JSON.stringify({
    retry: {
      enabled: "yes",
      maxRetries: "3",
      baseDelayMs: -1,
      provider: "oops",
    },
  }));
  const parsedBad = await readAgentRetry();
  assertEqual(parsedBad.enabled, DEFAULT_AGENT_RETRY.enabled, "boolean string falls back to default");
  assertEqual(parsedBad.maxRetries, DEFAULT_AGENT_RETRY.maxRetries, "string falls back to default");
  assertEqual(parsedBad.baseDelayMs, DEFAULT_AGENT_RETRY.baseDelayMs, "negative falls back to default");
  assertTrue(parsedBad.provider.timeoutMs === undefined, "provider.timeoutMs default = undefined");
  assertTrue(parsedBad.provider.maxRetries === undefined, "provider.maxRetries default = undefined");
  assertTrue(parsedBad.provider.maxRetryDelayMs === 60000, "provider.maxRetryDelayMs default = 60000 (SDK default)");

  section("8. write preserves unknown top-level keys");
  const before = JSON.stringify({
    lastChangelogVersion: "0.78.1",
    defaultProvider: "minimax-cn",
    defaultModel: "MiniMax-M3",
    defaultThinkingLevel: "high",
    packages: ["pi-skills"],
    theme: "dark",
    skills: ["+skills/playwright-cli/SKILL.md"],
    enableSkillCommands: true,
    futureKey: { foo: "bar" },
  });
  writeRaw(before);
  await writeAgentRetry({
    enabled: false,
    maxRetries: 5,
    baseDelayMs: 3000,
    provider: { maxRetryDelayMs: 30000 },
  });
  const afterWrite = JSON.parse(readRaw());
  assertEqual(afterWrite.lastChangelogVersion, "0.78.1", "lastChangelogVersion preserved");
  assertEqual(afterWrite.defaultProvider, "minimax-cn", "defaultProvider preserved");
  assertEqual(afterWrite.defaultModel, "MiniMax-M3", "defaultModel preserved");
  assertEqual(afterWrite.defaultThinkingLevel, "high", "defaultThinkingLevel preserved");
  assertEqual(afterWrite.packages, ["pi-skills"], "packages preserved");
  assertEqual(afterWrite.theme, "dark", "theme preserved");
  assertEqual(afterWrite.skills, ["+skills/playwright-cli/SKILL.md"], "skills preserved");
  assertEqual(afterWrite.enableSkillCommands, true, "enableSkillCommands preserved");
  assertEqual(afterWrite.futureKey, { foo: "bar" }, "futureKey preserved");
  assertEqual(afterWrite.retry, {
    enabled: false,
    maxRetries: 5,
    baseDelayMs: 3000,
    provider: { maxRetryDelayMs: 30000 },
  }, "retry block written");

  section("9. write round-trip");
  writeRaw(JSON.stringify({ defaultProvider: "p", defaultModel: "m" }));
  const want = {
    enabled: true,
    maxRetries: 7,
    baseDelayMs: 1234,
    provider: {
      timeoutMs: 5500,
      maxRetries: 1,
      maxRetryDelayMs: 7777,
    },
  };
  await writeAgentRetry(want);
  assertEqual(await readAgentRetry(), want, "round-trip preserves all fields");

  section("10. write with empty provider block == omit it");
  writeRaw(JSON.stringify({ defaultProvider: "p" }));
  await writeAgentRetry({
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
    provider: {},
  });
  const afterEmptyProvider = JSON.parse(readRaw());
  assertTrue(!("provider" in afterEmptyProvider.retry), "empty provider block is omitted from the file");
  assertEqual(afterEmptyProvider.retry.enabled, true, "main retry fields still written");
  assertEqual(afterEmptyProvider.retry.maxRetries, 3, "maxRetries written");

  section("11. maxRetryDelayMs = 0 is honored");
  writeRaw(JSON.stringify({}));
  await writeAgentRetry({
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
    provider: { maxRetryDelayMs: 0 },
  });
  const afterZero = JSON.parse(readRaw());
  assertTrue(afterZero.retry.provider.maxRetryDelayMs === 0, "0 is preserved (means 'disable cap')");

  section("12. reset removes retry key");
  const beforeReset = JSON.stringify({
    defaultProvider: "p",
    defaultModel: "m",
    retry: { enabled: false, maxRetries: 1, baseDelayMs: 100, provider: {} },
  });
  writeRaw(beforeReset);
  await resetAgentRetry();
  const afterReset = JSON.parse(readRaw());
  assertTrue(!("retry" in afterReset), "retry key is removed");
  assertEqual(afterReset.defaultProvider, "p", "defaultProvider preserved");
  assertEqual(afterReset.defaultModel, "m", "defaultModel preserved");
  assertEqual(await readAgentRetry(), DEFAULT_AGENT_RETRY, "post-reset read returns defaults");

  section("13. atomic write cleanup");
  for (const f of listTmp()) rmSync(join(tmpDir, f));
  writeRaw(JSON.stringify({ defaultProvider: "p" }));
  await writeAgentRetry(DEFAULT_AGENT_RETRY);
  const leftover = listTmp();
  const leftoverTmp = leftover.filter((f) => f.includes(".tmp."));
  const leftoverBak = leftover.filter((f) => f.includes(".bak."));
  assertTrue(leftoverTmp.length === 0, `no stray .tmp files (got: ${leftoverTmp.join(", ") || "(none)"})`);
  assertTrue(leftoverBak.length === 1, `exactly one .bak file per write (got: ${leftoverBak.join(", ") || "(none)"})`);

  section("14. .bak file is created on each write");
  for (const f of listTmp()) rmSync(join(tmpDir, f));
  writeRaw(JSON.stringify({ defaultProvider: "before" }));
  await sleep(5);
  await writeAgentRetry({
    enabled: false,
    maxRetries: 4,
    baseDelayMs: 1500,
    provider: {},
  });
  await sleep(5);
  const bakFiles = readdirSync(tmpDir).filter((f) => f.includes(".bak."));
  assertTrue(bakFiles.length === 1, `exactly one .bak file (got ${bakFiles.length}: ${bakFiles.join(", ")})`);
  if (bakFiles.length > 0) {
    const bakContent = JSON.parse(readFileSync(join(tmpDir, bakFiles[0]), "utf8"));
    assertEqual(bakContent.defaultProvider, "before", ".bak contains pre-write content");
    assertTrue(!("retry" in bakContent) || bakContent.retry === undefined, ".bak does not contain the new retry block");
  }

  section("15. repeat write/read consistency");
  writeRaw(JSON.stringify({}));
  for (let i = 0; i < 5; i++) {
    await writeAgentRetry({
      enabled: i % 2 === 0,
      maxRetries: 3 + i,
      baseDelayMs: 1000 * (i + 1),
      provider: { maxRetryDelayMs: 60000 + i },
    });
    const got = await readAgentRetry();
    assertTrue(got.maxRetries === 3 + i, `iter ${i}: maxRetries ${got.maxRetries}`);
    assertTrue(got.baseDelayMs === 1000 * (i + 1), `iter ${i}: baseDelayMs ${got.baseDelayMs}`);
    assertTrue(got.provider.maxRetryDelayMs === 60000 + i, `iter ${i}: maxRetryDelayMs ${got.provider.maxRetryDelayMs}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (realSettingsContentBeforeSnapshot !== null && existsSync(realSettingsPath)) {
    const afterMtime = statSync(realSettingsPath).mtimeMs;
    if (afterMtime === realSettingsMtimeBefore) {
      const afterContent = readFileSync(realSettingsPath, "utf8");
      if (afterContent === realSettingsContentBeforeSnapshot) {
        ok("real ~/.pi/agent/settings.json was not touched");
      } else {
        fail_("real settings.json content changed during the test run");
      }
    } else {
      fail_("real settings.json mtime changed during the test run");
    }
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(1);
});