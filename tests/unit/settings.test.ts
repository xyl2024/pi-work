import { afterAll, describe, expect, it } from "vitest";
import { unlink } from "node:fs/promises";
import { PANEL_TAB_KINDS } from "@/lib/shared/panelTabs";
import { api, expectOk, uniqueId, type Json } from "./helpers";

let original: Json | undefined;

interface SessionState {
  sessionId?: string;
  sessionFile?: string;
  systemPrompt?: string;
}

async function newSessionState(): Promise<SessionState> {
  const { status, body } = await api("/api/agent/new", {
    method: "POST",
    body: JSON.stringify({ cwd: process.cwd(), type: "get_state" }),
  });
  expectOk(status, body);
  const state = body.data as SessionState;
  return { ...state, sessionId: (body.sessionId as string | undefined) ?? state.sessionId };
}

async function sessionState(sessionId: string): Promise<SessionState> {
  const { status, body } = await api(`/api/agent/${sessionId}`, {
    method: "POST",
    body: JSON.stringify({ type: "get_state" }),
  });
  expectOk(status, body);
  return body.data as SessionState;
}

async function setLoadPiDocs(value: boolean): Promise<void> {
  const put = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ load_pi_docs: value }),
  });
  expect(put.status).toBe(200);
  expect(((await api("/api/settings")).body as Json).load_pi_docs).toBe(value);
}

afterAll(async () => {
  if (original) {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(original) });
  }
});

describe("settings api", () => {
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

    const back = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ load_pi_docs: true }),
    });
    expect(back.status).toBe(200);
    const on = await api("/api/settings");
    expect((on.body as Json).load_pi_docs).toBe(true);
  });

  it("keeps pi documentation out of the session prompt while the toggle is off", async () => {
    const initial = ((await api("/api/settings")).body as Json).load_pi_docs as boolean;
    try {
      await setLoadPiDocs(false);
      const state = await newSessionState();
      try {
        expect(state.systemPrompt).toContain("<cwd>");
        expect(state.systemPrompt).not.toContain("<docs>");
        expect(state.systemPrompt).not.toContain("Pi documentation");
      } finally {
        if (state.sessionFile) await unlink(state.sessionFile).catch(() => {});
      }
    } finally {
      await setLoadPiDocs(initial);
    }
  }, 120_000);

  it("applies the pi documentation toggle to a session that is already open", async () => {
    const initial = ((await api("/api/settings")).body as Json).load_pi_docs as boolean;
    try {
      await setLoadPiDocs(true);
      const state = await newSessionState();
      try {
        expect(state.sessionId).toBeTruthy();
        expect((await sessionState(state.sessionId!)).systemPrompt).toContain("Pi documentation");

        await setLoadPiDocs(false);
        expect((await sessionState(state.sessionId!)).systemPrompt).not.toContain("Pi documentation");
      } finally {
        if (state.sessionFile) await unlink(state.sessionFile).catch(() => {});
      }
    } finally {
      await setLoadPiDocs(initial);
    }
  }, 120_000);

  it("rejects out-of-range file_viewer limits with 400", async () => {
    const bad = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ file_viewer: { max_size_mb: { text: 101 } } }),
    });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toContain("text");

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

describe("settings api: right side bar", () => {
  const PREVIOUSLY_UNCONFIGURABLE = ["llmAudit"];

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
      expect(typeof read.translate).toBe("boolean");
    } finally {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...before, right_side_bar: rightSideBar }),
      });
    }
  });
});

describe("settings api: PUT is a patch over owned keys", () => {
  const cwd = `/tmp/${uniqueId("settings-sentinel")}`;
  const alias = uniqueId("alias");

  async function readAlias(): Promise<string | undefined> {
    const res = await api("/api/cwd-aliases");
    expect(res.status).toBe(200);
    return res.body[cwd] as string | undefined;
  }

  it("leaves another feature's key untouched when a stale full snapshot is PUT", async () => {
    const stale = (await api("/api/settings")).body;

    const planted = await api("/api/cwd-aliases", {
      method: "POST",
      body: JSON.stringify({ cwd, alias }),
    });
    expect(planted.status).toBe(200);
    expect(await readAlias()).toBe(alias);

    const beforeLoadPiDocs = stale.load_pi_docs;
    try {
      const put = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...stale, load_pi_docs: !beforeLoadPiDocs }),
      });
      expect(put.status).toBe(200);
      expect(((await api("/api/settings")).body as Json).load_pi_docs).toBe(!beforeLoadPiDocs);
      expect(await readAlias()).toBe(alias);

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
