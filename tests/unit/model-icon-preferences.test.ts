import { afterAll, describe, expect, it } from "vitest";
import { api, uniqueId } from "./helpers";
import { normalizeModelIconPreferences } from "@/lib/shared/model-icon-match";

/**
 * 图标偏好 (model icon preferences) contract seam, driven through real HTTP
 * against the isolated instance:
 *  - /api/model-icon-preferences GET/PUT (whole-map response),
 *  - /api/models.modelIconPreferences (whole map, always present).
 *
 * Policy: snapshot the original map, mutate only uniquely keyed entries,
 * restore everything in afterAll. The JSON file is never read directly.
 */

type Preferences = Record<string, string>;

let original: Preferences | undefined;

async function snapshot(): Promise<void> {
  const res = await api("/api/model-icon-preferences");
  if (res.status === 200) original = (res.body.preferences as Preferences | undefined) ?? {};
}

async function put(provider: string, modelId: string, preference: string) {
  return api("/api/model-icon-preferences", {
    method: "PUT",
    body: JSON.stringify({ provider, modelId, preference }),
  });
}

async function preferences(): Promise<Preferences> {
  const res = await api("/api/model-icon-preferences");
  expect(res.status).toBe(200);
  return res.body.preferences as Preferences;
}

async function modelsPreferences(): Promise<Preferences> {
  const res = await api("/api/models");
  expect(res.status).toBe(200);
  return res.body.modelIconPreferences as Preferences;
}

afterAll(async () => {
  if (!original) return;
  const current = await preferences();
  for (const key of Object.keys(current)) {
    if (key in original) continue;
    const at = key.indexOf(":");
    if (at === -1) continue;
    await put(key.slice(0, at), key.slice(at + 1), "auto");
  }
  for (const [key, preference] of Object.entries(original)) {
    const at = key.indexOf(":");
    if (at === -1) continue;
    await put(key.slice(0, at), key.slice(at + 1), preference);
  }
});

describe("model icon preferences api", () => {
  it("stores a provider deviation, exposes it on /api/models, then clears it", async () => {
    await snapshot();
    const provider = uniqueId("pref-provider");
    const modelId = uniqueId("model");
    const key = `${provider}:${modelId}`;

    expect(await preferences()).not.toHaveProperty(key);

    const set = await put(provider, modelId, "provider");
    expect(set.status).toBe(200);
    expect((set.body.preferences as Preferences)[key]).toBe("provider");

    // Whole map comes back from PUT, so the client needs no second request.
    const afterSet = await preferences();
    expect(afterSet[key]).toBe("provider");
    expect((await modelsPreferences())[key]).toBe("provider");

    const cleared = await put(provider, modelId, "auto");
    expect(cleared.status).toBe(200);
    expect(cleared.body.preferences as Preferences).not.toHaveProperty(key);

    expect(await preferences()).not.toHaveProperty(key);
    expect(await modelsPreferences()).not.toHaveProperty(key);
  });

  it("serves a freshly stored deviation on a second GET", async () => {
    await snapshot();
    const provider = uniqueId("pref-persist");
    const modelId = uniqueId("model");
    const key = `${provider}:${modelId}`;

    expect((await put(provider, modelId, "provider")).status).toBe(200);

    expect((await preferences())[key]).toBe("provider");
    expect((await preferences())[key]).toBe("provider");
    expect((await modelsPreferences())[key]).toBe("provider");

    await put(provider, modelId, "auto");
  });

  it("always includes modelIconPreferences on /api/models, as an object", async () => {
    const res = await api("/api/models");
    expect(res.status).toBe(200);
    expect(res.body.modelIconPreferences).toBeTypeOf("object");
    expect(Array.isArray(res.body.modelIconPreferences)).toBe(false);
  });

  it.each([
    ["missing provider", { modelId: "m", preference: "provider" }],
    ["empty provider", { provider: "", modelId: "m", preference: "provider" }],
    ["missing modelId", { provider: "p", preference: "provider" }],
    ["empty modelId", { provider: "p", modelId: "", preference: "provider" }],
    ["over-long provider", { provider: "p".repeat(201), modelId: "m", preference: "provider" }],
    ["over-long modelId", { provider: "p", modelId: "m".repeat(201), preference: "provider" }],
    ["missing preference", { provider: "p", modelId: "m" }],
    ["unknown preference", { provider: "p", modelId: "m", preference: "auto-match" }],
    ["non-string preference", { provider: "p", modelId: "m", preference: 1 }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await api("/api/model-icon-preferences", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTypeOf("string");
  });
});

describe("normalizeModelIconPreferences", () => {
  it.each([
    ["missing", undefined],
    ["null", null],
    ["a string", "provider"],
    ["a number", 42],
    ["an array", ["provider"]],
    ["an object with non-string values", { "a:b": 1 }],
    ["an object with an unknown value", { "a:b": "auto" }],
    ["an object with an unknown provider-ish value", { "a:b": "anthropic" }],
  ])("treats %s as no deviation", (_label, value) => {
    expect(normalizeModelIconPreferences(value)).toEqual({});
  });

  it("keeps only real provider deviations", () => {
    expect(
      normalizeModelIconPreferences({
        "copilot:claude-sonnet-4-5": "provider",
        "x:y": "auto",
        "x:z": true,
      }),
    ).toEqual({ "copilot:claude-sonnet-4-5": "provider" });
  });
});
