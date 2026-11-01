import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readConfig } from "@/lib/server/config";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";
import { createSandbox } from "./sandbox";

function sandbox(): string {
  return createSandbox("pi-work-suggested-prompt-settings-").configPath;
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
