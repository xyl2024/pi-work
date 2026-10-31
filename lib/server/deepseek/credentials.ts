import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { DEEPSEEK_DEFAULT_BASE_URL, type DeepSeekApiKeyStatus } from "@/lib/shared/deepseek";
import { dataPath } from "../data-dir";

function keyFilePath(): string {
  return dataPath("deepseek", "api-key");
}

function readFileKey(): string | null {
  const file = keyFilePath();
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function readEnvKey(): string | null {
  return process.env.DEEPSEEK_API_KEY?.trim() || null;
}

export function maskDeepSeekApiKey(key: string): string {
  return key.length > 4 ? `••••${key.slice(-4)}` : "••••";
}

export function saveDeepSeekApiKey(key: string): void {
  const file = keyFilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key.trim(), "utf8");
  try {
    chmodSync(file, 0o600);
  } catch {}
}

export function loadDeepSeekApiKey(): string | null {
  return readFileKey() ?? readEnvKey();
}

export function deleteDeepSeekApiKey(): void {
  try {
    unlinkSync(keyFilePath());
  } catch {}
}

export function deepSeekApiKeyStatus(): DeepSeekApiKeyStatus {
  const fileKey = readFileKey();
  if (fileKey) {
    return { configured: true, source: "file", masked: maskDeepSeekApiKey(fileKey) };
  }
  const envKey = readEnvKey();
  if (envKey) {
    return { configured: true, source: "env", masked: maskDeepSeekApiKey(envKey) };
  }
  return { configured: false, source: null, masked: null };
}

export function deepSeekBaseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL?.trim().replace(/\/+$/, "") || DEEPSEEK_DEFAULT_BASE_URL;
}
