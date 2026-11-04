import { describe, expect, it } from "vitest";
import {
  MAIN_VIEW_KINDS,
  MAIN_VIEW_SPECS,
  MAIN_VIEW_SPEC_BY_KIND,
  createMainViewState,
  mainViewReducer,
  selectMainViewKind,
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

describe("mainView registry", () => {
  it("declares exactly one main view: scheduled tasks", () => {
    expect([...MAIN_VIEW_KINDS]).toEqual(["scheduler"]);
    expect(MAIN_VIEW_SPECS.map((spec) => spec.kind)).toEqual(["scheduler"]);
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

  it("reaches scheduled tasks through english and chinese keywords", () => {
    expect(MAIN_VIEW_SPEC_BY_KIND.scheduler.commands?.[0]?.labelKey).toBe(
      "Open scheduled tasks",
    );
    expect(MAIN_VIEW_SPEC_BY_KIND.scheduler.commands?.[0]?.keywords).toEqual(
      expect.arrayContaining(["scheduler", "定时", "定时任务"]),
    );
  });
});
