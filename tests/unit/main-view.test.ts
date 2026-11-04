import { describe, expect, it } from "vitest";
import { EN_TRANSLATIONS, ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import { PANEL_TAB_KINDS } from "@/lib/shared/panelTabs";
import {
  MAIN_VIEW_KINDS,
  MAIN_VIEW_SPECS,
  MAIN_VIEW_SPEC_BY_KIND,
  createMainViewState,
  mainViewReducer,
  selectMainViewKind,
  selectToggleExits,
  type MainViewAction,
  type MainViewState,
} from "@/lib/shared/mainView";

function reduce(state: MainViewState, ...actions: MainViewAction[]): MainViewState {
  return actions.reduce(mainViewReducer, state);
}

describe("mainView enter", () => {
  it("activates the requested kind and snapshots the panel mode", () => {
    const state = reduce(createMainViewState(), {
      type: "enter",
      kind: "scheduler",
      panelMode: "expanded",
    });

    expect(state).toEqual({ active: "scheduler", returnPanelMode: "expanded" });
    expect(selectMainViewKind(state)).toBe("scheduler");
  });

  it("keeps every panel mode it was handed", () => {
    for (const panelMode of ["closed", "normal", "expanded"] as const) {
      const state = reduce(createMainViewState(), {
        type: "enter",
        kind: "scheduler",
        panelMode,
      });

      expect(mainViewReducer(state, { type: "back" })).toEqual({ active: "chat" });
      expect(state).toEqual({ active: "scheduler", returnPanelMode: panelMode });
    }
  });
});

describe("mainView back", () => {
  it("always returns to chat", () => {
    const state = reduce(
      createMainViewState(),
      { type: "enter", kind: "scheduler", panelMode: "normal" },
      { type: "back" },
    );

    expect(state).toEqual({ active: "chat" });
    expect(selectMainViewKind(state)).toBe(null);
  });

  it("is a no-op while chat is already in front", () => {
    const state = createMainViewState();

    expect(mainViewReducer(state, { type: "back" })).toEqual({ active: "chat" });
  });

  it("remembers the panel mode it snapshotted on enter", () => {
    const entered = reduce(createMainViewState(), {
      type: "enter",
      kind: "scheduler",
      panelMode: "expanded",
    });

    expect(entered.active === "scheduler" && entered.returnPanelMode).toBe("expanded");
  });
});

describe("mainView toggle", () => {
  it("enters from chat", () => {
    const state = reduce(createMainViewState(), {
      type: "toggle",
      kind: "scheduler",
      panelMode: "normal",
    });

    expect(state).toEqual({ active: "scheduler", returnPanelMode: "normal" });
  });

  it("equals back when the same kind is already active", () => {
    const entered = reduce(createMainViewState(), {
      type: "enter",
      kind: "scheduler",
      panelMode: "normal",
    });

    expect(
      reduce(entered, { type: "toggle", kind: "scheduler", panelMode: "closed" }),
    ).toEqual({ active: "chat" });
  });
});

describe("mainView activate chat", () => {
  it("collapses any main view back to chat", () => {
    for (const kind of MAIN_VIEW_KINDS) {
      const entered = reduce(createMainViewState(), {
        type: "enter",
        kind,
        panelMode: "expanded",
      });

      expect(
        reduce(entered, { type: "activate_chat" }),
      ).toEqual({ active: "chat" });
    }
  });

  it("is idempotent while chat is in front", () => {
    const state = createMainViewState();

    expect(reduce(state, { type: "activate_chat" })).toEqual({ active: "chat" });
  });
});

describe("mainView toggle exits", () => {
  it("reports an exit only for the kind already in front", () => {
    expect(selectToggleExits({ active: "chat" }, "scheduler")).toBe(false);
    expect(
      selectToggleExits({ active: "scheduler", returnPanelMode: "normal" }, "scheduler"),
    ).toBe(true);
  });
});

describe("mainView registry", () => {
  it("orders the navigation by a unique priority starting with scheduled tasks", () => {
    const priorities = MAIN_VIEW_SPECS.map((spec) => spec.navPriority);

    expect(MAIN_VIEW_KINDS[0]).toBe("scheduler");
    expect([...priorities]).toEqual([...priorities].sort((a, b) => a - b));
    expect(new Set(priorities).size).toBe(priorities.length);
    expect(MAIN_VIEW_KINDS).toEqual(MAIN_VIEW_SPECS.map((spec) => spec.kind));
  });

  it("orders models config right after scheduled tasks in the navigation", () => {
    expect(MAIN_VIEW_KINDS.indexOf("modelsConfig")).toBe(
      MAIN_VIEW_KINDS.indexOf("scheduler") + 1,
    );
    expect(MAIN_VIEW_SPEC_BY_KIND.modelsConfig.navPriority).toBe(2);
    expect(MAIN_VIEW_SPEC_BY_KIND.modelsConfig.labelKey).toBe("Models config");
    expect(MAIN_VIEW_SPEC_BY_KIND.modelsConfig.backLabelKey).toBe("Back to chat");
  });

  it("registers channels as a main view in the fourth navigation slot", () => {
    expect(MAIN_VIEW_KINDS).toContain("channels");
    expect(MAIN_VIEW_SPEC_BY_KIND.channels.labelKey).toBe("Channels");
    expect(MAIN_VIEW_SPEC_BY_KIND.channels.backLabelKey).toBe("Back to chat");
    expect(MAIN_VIEW_SPEC_BY_KIND.channels.navPriority).toBe(4);
    expect(ZH_TRANSLATIONS["Channels"]).toBe("频道");
    expect(MAIN_VIEW_SPEC_BY_KIND.channels.commands?.[0]?.labelKey).toBe("Open channels");
    expect(MAIN_VIEW_SPEC_BY_KIND.channels.commands?.[0]?.keywords).toEqual(
      expect.arrayContaining(["channels", "wechat", "微信", "频道", "消息"]),
    );
  });

  it("keeps every main view out of the panel registry", () => {
    for (const kind of MAIN_VIEW_KINDS) {
      expect(PANEL_TAB_KINDS as readonly string[]).not.toContain(kind);
    }
  });

  it("labels the scheduled-tasks main view with the sidebar wording", () => {
    expect(MAIN_VIEW_SPEC_BY_KIND.scheduler.labelKey).toBe("Scheduled tasks");
  });

  it("gives every spec a palette entry with keywords", () => {
    for (const spec of MAIN_VIEW_SPECS) {
      expect(spec.labelKey).toBeTruthy();
      for (const entry of spec.commands ?? []) {
        expect(entry.labelKey).toBeTruthy();
        expect(entry.keywords.length).toBeGreaterThan(0);
        for (const keyword of entry.keywords) expect(keyword).toBeTruthy();
      }
    }
  });

  it("points the header back button at chat rather than at the view's own name", () => {
    expect(MAIN_VIEW_SPEC_BY_KIND.scheduler.labelKey).toBe("Scheduled tasks");
    expect(MAIN_VIEW_SPEC_BY_KIND.scheduler.backLabelKey).toBe("Back to chat");
    expect(ZH_TRANSLATIONS["Back to chat"]).toBe("会话");
    expect(EN_TRANSLATIONS["Back to chat"]).toBe("Back to chat");
  });

  it("names the sidebar's session-draft entry apart from the scheduler's New task", () => {
    expect(ZH_TRANSLATIONS["New session"]).toBe("新建会话");
    expect(ZH_TRANSLATIONS["New task"]).toBe("新建任务");
    expect(ZH_TRANSLATIONS["New session"]).not.toBe(ZH_TRANSLATIONS["New task"]);
  });

  it("registers skills third in the sidebar navigation", () => {
    const ordered = MAIN_VIEW_SPECS.map((spec) => spec.kind);

    expect(MAIN_VIEW_SPEC_BY_KIND.skills.navPriority).toBe(3);
    expect(ordered.indexOf("skills")).toBe(ordered.indexOf("modelsConfig") + 1);
    expect(ordered.indexOf("skills")).toBeGreaterThan(ordered.indexOf("scheduler"));
    expect(MAIN_VIEW_SPEC_BY_KIND.skills.labelKey).toBe("Skills");
    expect(MAIN_VIEW_SPEC_BY_KIND.skills.backLabelKey).toBe("Back to chat");
    expect(MAIN_VIEW_SPEC_BY_KIND.skills.commands?.[0]?.labelKey).toBe("Open skills");
    expect(MAIN_VIEW_SPEC_BY_KIND.skills.commands?.[0]?.keywords).toEqual(
      expect.arrayContaining(["skills", "技能"]),
    );
  });

  it("reaches scheduled tasks through english and chinese keywords", () => {
    expect(MAIN_VIEW_SPEC_BY_KIND.scheduler.commands?.[0]?.labelKey).toBe(
      "Open scheduled tasks",
    );
    expect(MAIN_VIEW_SPEC_BY_KIND.scheduler.commands?.[0]?.keywords).toEqual(
      expect.arrayContaining(["scheduler", "定时", "定时任务"]),
    );
  });
});
