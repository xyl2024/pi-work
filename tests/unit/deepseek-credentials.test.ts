import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "pi-work-deepseek-credentials-"));
const keyFile = join(root, "deepseek", "api-key");

type Credentials = typeof import("@/lib/server/deepseek/credentials");
let credentials: Credentials;

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  vi.resetModules();
  credentials = await import("@/lib/server/deepseek/credentials");
});

beforeEach(() => {
  credentials.deleteDeepSeekApiKey();
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_BASE_URL;
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_BASE_URL;
  rmSync(root, { recursive: true, force: true });
});

describe("DeepSeek API key store", () => {
  it("writes the key to the Pi Work data dir with 0600 permissions and reads it back", () => {
    credentials.saveDeepSeekApiKey("sk-file-123456789");

    expect(readFileSync(keyFile, "utf8")).toBe("sk-file-123456789");
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(credentials.loadDeepSeekApiKey()).toBe("sk-file-123456789");
  });

  it("prefers the saved file key over DEEPSEEK_API_KEY", () => {
    process.env.DEEPSEEK_API_KEY = "sk-env-0000";
    credentials.saveDeepSeekApiKey("sk-file-9999");

    expect(credentials.loadDeepSeekApiKey()).toBe("sk-file-9999");
  });

  it("falls back to DEEPSEEK_API_KEY when no file key exists", () => {
    process.env.DEEPSEEK_API_KEY = "sk-env-0000";

    expect(credentials.loadDeepSeekApiKey()).toBe("sk-env-0000");
  });

  it("returns null when neither source is configured", () => {
    expect(credentials.loadDeepSeekApiKey()).toBeNull();
  });

  it("deletes the key idempotently", () => {
    credentials.saveDeepSeekApiKey("sk-file-123456789");
    credentials.deleteDeepSeekApiKey();
    credentials.deleteDeepSeekApiKey();

    expect(credentials.loadDeepSeekApiKey()).toBeNull();
  });
});

describe("DeepSeek API key status", () => {
  it("reports the file key with only its last four characters", () => {
    credentials.saveDeepSeekApiKey("sk-abcdefghijklmnop");

    expect(credentials.deepSeekApiKeyStatus()).toEqual({
      configured: true,
      source: "file",
      masked: "••••mnop",
    });
  });

  it("never exposes the full plaintext in any status field", () => {
    const key = "sk-super-secret-value-4321";
    credentials.saveDeepSeekApiKey(key);
    const status = JSON.stringify(credentials.deepSeekApiKeyStatus());

    expect(status).not.toContain(key);
    expect(status).not.toContain("sk-super");
    expect(status).toContain("4321");
  });

  it("reports the environment fallback as the source when no file key exists", () => {
    process.env.DEEPSEEK_API_KEY = "sk-env-key-9876";

    expect(credentials.deepSeekApiKeyStatus()).toEqual({
      configured: true,
      source: "env",
      masked: "••••9876",
    });
  });

  it("reports an unconfigured status with no mask", () => {
    expect(credentials.deepSeekApiKeyStatus()).toEqual({
      configured: false,
      source: null,
      masked: null,
    });
  });
});

describe("DeepSeek base URL", () => {
  it("defaults to the official endpoint", () => {
    expect(credentials.deepSeekBaseUrl()).toBe("https://api.deepseek.com");
  });

  it("honors DEEPSEEK_BASE_URL without a trailing slash", () => {
    process.env.DEEPSEEK_BASE_URL = "https://gateway.example.com/deepseek///";

    expect(credentials.deepSeekBaseUrl()).toBe("https://gateway.example.com/deepseek");
  });
});
