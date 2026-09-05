import { afterAll, describe, expect, it } from "vitest";
import { api, uniqueId, type Json } from "./helpers";

/**
 * /api/settings reads/writes the isolated root's config.yaml.
 * Policy: snapshot the GET payload, apply a reversible toggle, verify,
 * restore the original config, then exercise the validation paths (400).
 *
 * Note: GET masks tavily.api_key into { has_api_key }, so the snapshot is
 * PUT-safe only if we restore from the PUT-accepted merge semantics — the
 * final PUT passes the whole snapshot back; tavily.api_key stays untouched
 * server-side because the merged body carries no api_key/clear_api_key.
 */
let original: Json | undefined;

afterAll(async () => {
  if (original) {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(original) });
  }
});

describe("settings api", () => {
  it("reads the config with masked tavily key", async () => {
    const res = await api("/api/settings");
    expect(res.status).toBe(200);
    const cfg = res.body;
    expect(cfg.web_access).toBeTypeOf("object");
    const tavily = (cfg.web_access as Json).tavily as Json;
    expect(tavily.has_api_key).toBeTypeOf("boolean");
    // masked — never returns the raw key
    expect(tavily.api_key).toBeUndefined();
  });

  it("applies a reversible ui_sounds toggle and restores", async () => {
    const before = await api("/api/settings");
    expect(before.status).toBe(200);
    original = before.body;

    const nextValue = !(original as Json).ui_sounds
      ? true
      : !((original as Json).ui_sounds as Json).enabled;
    const put = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ ui_sounds: { enabled: nextValue } }),
    });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const after = await api("/api/settings");
    expect(after.status).toBe(200);
    expect(((after.body.ui_sounds ?? {}) as Json).enabled).toBe(nextValue);
  });

  it("rejects out-of-range file_viewer limits with 400", async () => {
    // text max is 100 MB — 101 must fail
    const bad = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ file_viewer: { max_size_mb: { text: 101 } } }),
    });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toContain("text");

    // non-integer must fail
    const nonInt = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ file_viewer: { max_size_mb: { image: 1.5 } } }),
    });
    expect(nonInt.status).toBe(400);
  });

  it("rejects unknown ui_sounds events with 400", async () => {
    const bad = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ ui_sounds: { events: { [uniqueId("bogus")]: "x.mp3" } } }),
    });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toContain("unknown event");
  });
});
