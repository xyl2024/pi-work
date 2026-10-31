import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "@/lib/server/config";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";

const created: string[] = [];
const savedDataDir = process.env.PI_WORK_DATA_DIR;

function sandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pi-work-suggested-prompt-settings-"));
  created.push(root);
  const dataDir = path.join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  process.env.PI_WORK_DATA_DIR = dataDir;
  delete globalThis.__piWorkConfigCache;
  return path.join(dataDir, "config.yaml");
}

function put(body: unknown): Promise<Response> {
  return putSettings(
    new Request("http://localhost:30143/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (savedDataDir === undefined) delete process.env.PI_WORK_DATA_DIR;
  else process.env.PI_WORK_DATA_DIR = savedDataDir;
  delete globalThis.__piWorkConfigCache;
});

describe("suggested prompt settings", () => {
  it("defaults to enabled with no model when the key is absent", () => {
    const configPath = sandbox();
    writeFileSync(configPath, "load_pi_docs: false\n", "utf8");

    expect(readConfig().suggested_prompt).toEqual({ enabled: true, model: null });
  });

  it("stores the toggle and the generation model through the settings route", async () => {
    sandbox();

    const response = await put({
      suggested_prompt: { enabled: false, model: { provider: "cheap", modelId: "mini" } },
    });
    expect(response.status).toBe(200);

    const body = await (await getSettings()).json();
    expect(body.suggested_prompt).toEqual({
      enabled: false,
      model: { provider: "cheap", modelId: "mini" },
    });
  });

  it("rejects a malformed generation model", async () => {
    sandbox();

    const response = await put({ suggested_prompt: { enabled: true, model: { provider: "cheap" } } });
    expect(response.status).toBe(400);
    expect(readConfig().suggested_prompt).toEqual({ enabled: true, model: null });
  });
});
