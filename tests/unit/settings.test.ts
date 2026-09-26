import { afterAll, describe, expect, it } from "vitest";
import { PANEL_TAB_KINDS } from "@/lib/shared/panelTabs";
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

  it("applies a reversible load_pi_docs toggle and restores", async () => {
    const before = await api("/api/settings");
    expect(before.status).toBe(200);
    // Defaults to on so existing prompts keep pi's built-in Pi documentation.
    expect((before.body as Json).load_pi_docs).toBe(true);

    const put = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ load_pi_docs: false }),
    });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const off = await api("/api/settings");
    expect(off.status).toBe(200);
    expect((off.body as Json).load_pi_docs).toBe(false);

    // Restore.
    const back = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ load_pi_docs: true }),
    });
    expect(back.status).toBe(200);
    const on = await api("/api/settings");
    expect((on.body as Json).load_pi_docs).toBe(true);
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

/**
 * right_side_bar is the panel registry's slice of the config: the server
 * defaults are derived from `PANEL_TAB_SPEC_BY_KIND`, so every panel view is
 * configurable without touching the server, and the two deleted panels
 * (canvas / json) leave nothing behind.
 */
describe("settings api: right side bar", () => {
  /** Panels missing from the hand-kept defaults used to be un-toggleable. */
  const PREVIOUSLY_UNCONFIGURABLE = [
    "githubTrending",
    "notes",
    "kanban",
    "llmAudit",
    "btw",
  ];

  async function snapshot(): Promise<Json> {
    const res = await api("/api/settings");
    expect(res.status).toBe(200);
    return res.body;
  }

  it("offers every registered panel view in the defaults", async () => {
    const cfg = await snapshot();
    const rightSideBar = cfg.right_side_bar as Json;

    for (const id of PANEL_TAB_KINDS) {
      expect(typeof rightSideBar[id], `right_side_bar.${id}`).toBe("boolean");
    }
    // Panels that were deleted left no key behind.
    expect(rightSideBar.canvas).toBeUndefined();
    expect(rightSideBar.json).toBeUndefined();
  });

  it("persists hiding a panel through a write/read round trip", async () => {
    const before = await snapshot();
    const rightSideBar = before.right_side_bar as Json;

    try {
      const put = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...before,
          right_side_bar: {
            ...rightSideBar,
            ...Object.fromEntries(PREVIOUSLY_UNCONFIGURABLE.map((id) => [id, false])),
          },
        }),
      });
      expect(put.status).toBe(200);

      const after = await snapshot();
      const read = after.right_side_bar as Json;
      for (const id of PREVIOUSLY_UNCONFIGURABLE) {
        expect(read[id], `right_side_bar.${id} after a restart`).toBe(false);
      }
    } finally {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...before, right_side_bar: rightSideBar }),
      });
    }
  });

  it("ignores stale canvas / json keys in an existing config", async () => {
    const before = await snapshot();
    const rightSideBar = before.right_side_bar as Json;

    try {
      const put = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...before,
          right_side_bar: { ...rightSideBar, canvas: false, json: false },
        }),
      });
      expect(put.status).toBe(200);

      const after = await snapshot();
      const read = after.right_side_bar as Json;
      expect(read.canvas).toBeUndefined();
      expect(read.json).toBeUndefined();
      // …and the real panel keys still parse alongside the stale ones.
      expect(typeof read.translate).toBe("boolean");
    } finally {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...before, right_side_bar: rightSideBar }),
      });
    }
  });
});

/**
 * PUT /api/settings is a patch scoped to the keys it owns. A stale full-config
 * snapshot submitted by an old page must not be able to reset a key another
 * feature owns (here: `cwd_aliases`, planted through its own route). The
 * ignored keys are skipped, not rejected.
 */
describe("settings api: PUT is a patch over owned keys", () => {
  const cwd = `/tmp/${uniqueId("settings-sentinel")}`;
  const alias = uniqueId("alias");

  async function readAlias(): Promise<string | undefined> {
    const res = await api("/api/cwd-aliases");
    expect(res.status).toBe(200);
    return res.body[cwd] as string | undefined;
  }

  it("leaves another feature's key untouched when a stale full snapshot is PUT", async () => {
    // 1. Snapshot the config *before* the other feature writes its key.
    const stale = (await api("/api/settings")).body;

    // 2. The other feature writes cwd_aliases (sidebar-set alias).
    const planted = await api("/api/cwd-aliases", {
      method: "POST",
      body: JSON.stringify({ cwd, alias }),
    });
    expect(planted.status).toBe(200);
    expect(await readAlias()).toBe(alias);

    const beforeLoadPiDocs = stale.load_pi_docs;
    try {
      // 3. An old page submits the whole config it remembers, without the alias.
      const put = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...stale, load_pi_docs: !beforeLoadPiDocs }),
      });
      expect(put.status).toBe(200);
      expect(((await api("/api/settings")).body as Json).load_pi_docs).toBe(!beforeLoadPiDocs);
      // …and the sentinel is still there.
      expect(await readAlias()).toBe(alias);

      // 4. A single-key patch behaves the same.
      const patch = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ load_pi_docs: beforeLoadPiDocs }),
      });
      expect(patch.status).toBe(200);
      expect(await readAlias()).toBe(alias);
      expect(((await api("/api/settings")).body as Json).load_pi_docs).toBe(beforeLoadPiDocs);
    } finally {
      await api("/api/cwd-aliases", {
        method: "POST",
        body: JSON.stringify({ cwd, alias: null }),
      });
    }
  });

  it("ignores non-owned keys without an error", async () => {
    const sentinel = { [cwd]: [uniqueId("skill")] };
    const put = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ disabled_skills: sentinel, load_pi_docs: true }),
    });
    expect(put.status).toBe(200);
    const after = await api("/api/settings");
    expect((after.body as Json).disabled_skills).not.toEqual(sentinel);
  });
});
