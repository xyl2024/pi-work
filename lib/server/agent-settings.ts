import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createLogger } from "./logger";
import {
  DEFAULT_AGENT_RETRY,
  type AgentRetryConfig,
  type ProviderRetryConfig,
} from "../shared/agent-settings-types";

export { DEFAULT_AGENT_RETRY };
export type { AgentRetryConfig, ProviderRetryConfig };

const log = createLogger("agent-settings");

let _sdkModule: { getAgentDir: () => string } | null = null;
let _sdkLoading: Promise<void> | null = null;

function dynamicImport<T>(specifier: string): Promise<T> {
  const dynImport = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;
  return dynImport(specifier) as Promise<T>;
}

async function ensureSdkLoaded(): Promise<void> {
  if (_sdkModule !== null) return;
  if (_sdkLoading === null) {
    _sdkLoading = dynamicImport<{ getAgentDir: () => string }>("@earendil-works/pi-coding-agent")
      .then((m) => {
        _sdkModule = m;
      })
      .catch((err) => {
        log.warn("failed to load @earendil-works/pi-coding-agent; using env-var fallback only", {
          error: String(err),
        });
        _sdkLoading = null;
      });
  }
  await _sdkLoading;
}

void ensureSdkLoaded();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseProviderRetry(raw: unknown): ProviderRetryConfig {
  if (!isPlainObject(raw)) return { ...DEFAULT_AGENT_RETRY.provider };
  const obj = raw;
  const out: ProviderRetryConfig = {};
  const t = obj.timeoutMs;
  if (typeof t === "number" && Number.isFinite(t) && t >= 0) out.timeoutMs = t;
  const r = obj.maxRetries;
  if (typeof r === "number" && Number.isFinite(r) && r >= 0) out.maxRetries = r;
  const d = obj.maxRetryDelayMs;
  if (typeof d === "number" && Number.isFinite(d) && d >= 0) out.maxRetryDelayMs = d;
  return out;
}

function parseRetry(raw: unknown): AgentRetryConfig {
  if (!isPlainObject(raw)) return { ...DEFAULT_AGENT_RETRY, provider: { ...DEFAULT_AGENT_RETRY.provider } };
  const obj = raw;
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_AGENT_RETRY.enabled,
    maxRetries: typeof obj.maxRetries === "number" && Number.isFinite(obj.maxRetries) && obj.maxRetries >= 0
      ? obj.maxRetries
      : DEFAULT_AGENT_RETRY.maxRetries,
    baseDelayMs: typeof obj.baseDelayMs === "number" && Number.isFinite(obj.baseDelayMs) && obj.baseDelayMs >= 0
      ? obj.baseDelayMs
      : DEFAULT_AGENT_RETRY.baseDelayMs,
    provider: parseProviderRetry(obj.provider),
  };
}

export async function getAgentSettingsPath(): Promise<string> {
  if (process.env.PI_CODING_AGENT_DIR) {
    return join(process.env.PI_CODING_AGENT_DIR, "settings.json");
  }
  await ensureSdkLoaded();
  if (_sdkModule !== null) {
    return join(_sdkModule.getAgentDir(), "settings.json");
  }
  return join(homedir(), ".pi", "agent", "settings.json");
}

async function readRawSettings(): Promise<Record<string, unknown>> {
  const path = await getAgentSettingsPath();
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    log.warn("failed to read agent settings, treating as empty", { path, error: String(err) });
    return {};
  }
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  try {
    const parsed = JSON.parse(trimmed);
    return isPlainObject(parsed) ? parsed : {};
  } catch (err) {
    log.warn("agent settings json malformed; returning defaults without modifying file", {
      path,
      error: String(err),
    });
    return {};
  }
}

async function writeRawSettingsAtomic(next: Record<string, unknown>): Promise<void> {
  const path = await getAgentSettingsPath();
  const tmpPath = `${path}.tmp.${Date.now()}`;
  const backupPath = `${path}.bak.${Date.now()}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(next, null, 2) + "\n", "utf8");
    if (existsSync(path)) {
      try {
        const prev = readFileSync(path, "utf8");
        writeFileSync(backupPath, prev, "utf8");
      } catch (err) {
        log.warn("could not snapshot pre-write backup", { backupPath, error: String(err) });
      }
    }
    renameSync(tmpPath, path);
    log.info("agent settings written", {
      path,
      hadBackup: existsSync(backupPath),
      keys: Object.keys(next),
    });
  } catch (err) {
    log.error("agent settings write failed", { path, tmpPath, error: String(err) });
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}

export async function readAgentRetry(): Promise<AgentRetryConfig> {
  const raw = await readRawSettings();
  return parseRetry(raw.retry);
}

export async function writeAgentRetry(next: AgentRetryConfig): Promise<Record<string, unknown>> {
  const current = await readRawSettings();
  const merged: Record<string, unknown> = {
    ...current,
    retry: serializeRetry(next),
  };
  await writeRawSettingsAtomic(merged);
  return merged;
}

function serializeRetry(retry: AgentRetryConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    enabled: retry.enabled,
    maxRetries: retry.maxRetries,
    baseDelayMs: retry.baseDelayMs,
  };
  const provider: Record<string, unknown> = {};
  if (typeof retry.provider.timeoutMs === "number") provider.timeoutMs = retry.provider.timeoutMs;
  if (typeof retry.provider.maxRetries === "number") provider.maxRetries = retry.provider.maxRetries;
  if (typeof retry.provider.maxRetryDelayMs === "number") provider.maxRetryDelayMs = retry.provider.maxRetryDelayMs;
  if (Object.keys(provider).length > 0) out.provider = provider;
  return out;
}

export async function resetAgentRetry(): Promise<Record<string, unknown>> {
  const current = await readRawSettings();
  const { retry: _drop, ...rest } = current;
  void _drop;
  await writeRawSettingsAtomic(rest);
  return rest;
}