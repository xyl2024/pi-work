import { describe, expect, it } from "vitest";
import {
  BTW_TAB_ID,
  FAVORITES_TAB_ID,
  GIT_DIFF_TAB_ID,
  KANBAN_TAB_ID,
  NOTES_TAB_ID,
  RSS_TAB_ID,
  TRANSLATE_TAB_ID,
} from "@/lib/shared/types";
import {
  PANEL_BUTTON_ID_BY_KIND,
  PANEL_TAB_KINDS,
  PANEL_TAB_SPECS,
  createPanelTabsState,
  fileTabId,
  panelButtonIdForKind,
  panelTabsReducer,
  selectActiveKind,
  selectActiveTab,
  selectCanExpand,
  selectHasTabs,
  selectIsOpen,
  selectOpenCount,
  type PanelTabsAction,
  type PanelTabsState,
  type PanelViewKind,
} from "@/lib/shared/panelTabs";
import { buildCommands, type CommandContext } from "@/lib/client/commands";
import {
  PANEL_COMMAND_ICON_BY_KIND,
  PANEL_TAB_ICON_BY_KIND,
  RIGHT_BAR_BUTTON_IDS,
  RIGHT_BAR_DESCRIPTOR_BY_ID,
  RIGHT_BAR_DESCRIPTORS,
  resolveButtonContent,
  type RightBarCtx,
} from "@/components/panels/right-bar/desc";

/** Apply a list of actions in order — mirrors how the shell dispatches them. */
function reduce(state: PanelTabsState, ...actions: PanelTabsAction[]): PanelTabsState {
  return actions.reduce(panelTabsReducer, state);
}

/** Panel kinds present in the strip, newest first. */
function kinds(state: PanelTabsState): string[] {
  return state.tabs.map((tab) => tab.kind);
}

function openCount(state: PanelTabsState, id: string): number | undefined {
  return state.tabs.find((tab) => tab.id === id)?.openCount;
}

describe("panelTabs open", () => {
  it("opens a panel view once, activating it and opening the strip", () => {
    const state = reduce(createPanelTabsState(), { type: "open", kind: "translate" });

    expect(kinds(state)).toEqual(["translate"]);
    expect(selectActiveTab(state)?.kind).toBe("translate");
    expect(selectActiveKind(state)).toBe("translate");
    expect(selectIsOpen(state)).toBe(true);
    expect(state.mode).toBe("normal");
  });

  it("reuses the tab of an already open panel view and keeps it active", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "translate" },
      { type: "open", kind: "favorites" },
      { type: "open", kind: "translate" },
    );

    expect(kinds(state)).toEqual(["favorites", "translate"]);
    expect(selectActiveKind(state)).toBe("translate");
  });

  it("bumps openCount on every open, including re-opens", () => {
    const once = reduce(createPanelTabsState(), { type: "open", kind: "gitDiff" });
    const twice = reduce(once, { type: "open", kind: "gitDiff" });

    expect(openCount(once, GIT_DIFF_TAB_ID)).toBe(1);
    expect(openCount(twice, GIT_DIFF_TAB_ID)).toBe(2);
  });

  it("only upgrades the panel mode, never downgrades it", () => {
    // Kanban declares an expanded default, so it widens a fresh strip.
    const expanded = reduce(createPanelTabsState(), { type: "open", kind: "kanban" });
    expect(expanded.mode).toBe("expanded");

    // Opening a normal-default panel while expanded keeps it expanded.
    const stillExpanded = reduce(expanded, { type: "open", kind: "translate" });
    expect(stillExpanded.mode).toBe("expanded");

    // Opening kanban re-uses its tab; from normal it upgrades to expanded.
    const fromNormal = reduce(
      createPanelTabsState(),
      { type: "open", kind: "translate" },
      { type: "open", kind: "kanban" },
    );
    expect(fromNormal.mode).toBe("expanded");

    // …and a re-open of a normal panel does not pull it back down.
    expect(reduce(fromNormal, { type: "open", kind: "translate" }).mode).toBe("expanded");
  });

  it("keeps file preview tabs and panel view tabs in one strip", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "translate" },
      { type: "open_file", path: "/tmp/notes.md", label: "notes.md" },
    );

    expect(kinds(state)).toEqual(["file", "translate"]);
    expect(state.tabs[0].id).toBe(fileTabId("/tmp/notes.md"));
    expect(state.tabs[0].label).toBe("notes.md");
    expect(selectActiveKind(state)).toBe("file");
    expect(state.mode).toBe("normal");
  });

  it("reuses an already open file tab and bumps its openCount", () => {
    const path = "/tmp/notes.md";
    const state = reduce(
      createPanelTabsState(),
      { type: "open_file", path, label: "notes.md" },
      { type: "open", kind: "translate" },
      { type: "open_file", path, label: "notes.md" },
    );

    // Reusing the tab keeps its original position in the strip.
    expect(kinds(state)).toEqual(["translate", "file"]);
    expect(openCount(state, fileTabId(path))).toBe(2);
    expect(selectActiveKind(state)).toBe("file");
  });
});

describe("panelTabs toggle", () => {
  it("opens the panel when its tab is not active", () => {
    const state = reduce(createPanelTabsState(), { type: "toggle", kind: "btw" });

    expect(selectIsOpen(state)).toBe(true);
    expect(selectActiveKind(state)).toBe("btw");
    expect(openCount(state, BTW_TAB_ID)).toBe(1);
  });

  it("collapses the panel when the toggled tab is active and the panel is open", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "btw" },
      { type: "toggle", kind: "btw" },
    );

    // The tab stays in the strip so the next toggle reopens the same view.
    expect(kinds(state)).toEqual(["btw"]);
    expect(state.mode).toBe("closed");
    expect(selectIsOpen(state)).toBe(false);
    expect(selectActiveKind(state)).toBe(null);
  });

  it("reopens an already open tab whose panel was collapsed", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "btw" },
      { type: "set_mode", mode: "closed" },
      { type: "toggle", kind: "btw" },
    );

    expect(state.mode).toBe("normal");
    expect(openCount(state, BTW_TAB_ID)).toBe(2);
  });

  it("toggles a different panel view instead of collapsing the active one", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "btw" },
      { type: "toggle", kind: "translate" },
    );

    expect(state.mode).toBe("normal");
    expect(selectActiveKind(state)).toBe("translate");
  });
});

describe("panelTabs close", () => {
  it("falls back to the oldest remaining tab when the active one closes", () => {
    // Newest-first strip: kanban, translate, favorites (favorites is oldest).
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "favorites" },
      { type: "open", kind: "translate" },
      { type: "open", kind: "kanban" },
      { type: "close", id: KANBAN_TAB_ID },
    );

    expect(kinds(state)).toEqual(["translate", "favorites"]);
    expect(selectActiveKind(state)).toBe("favorites");
    expect(state.mode).not.toBe("closed");
  });

  it("keeps the active tab when a background tab closes", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "favorites" },
      { type: "open", kind: "translate" },
      { type: "close", id: FAVORITES_TAB_ID },
    );

    expect(selectActiveKind(state)).toBe("translate");
  });

  it("collapses the strip when the last tab closes", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "notes" },
      { type: "set_mode", mode: "expanded" },
      { type: "close", id: NOTES_TAB_ID },
    );

    expect(state.tabs).toEqual([]);
    expect(state.activeId).toBe(null);
    expect(state.mode).toBe("closed");
  });

  it("ignores a close of an unknown tab", () => {
    const before = reduce(createPanelTabsState(), { type: "open", kind: "notes" });
    const after = reduce(before, { type: "close", id: "file:/tmp/gone.md" });

    expect(after).toEqual(before);
  });
});

describe("panelTabs batch close", () => {
  // Newest-first strip used by the batch tests: translate, favorites, notes,
  // rss — i.e. rss is the oldest tab.
  function strip(): PanelTabsState {
    return reduce(
      createPanelTabsState(),
      { type: "open", kind: "rss" },
      { type: "open", kind: "notes" },
      { type: "open", kind: "favorites" },
      { type: "open", kind: "translate" },
    );
  }

  it("close_left drops the tabs left of the reference tab", () => {
    const state = reduce(strip(), { type: "close_left", id: NOTES_TAB_ID });

    expect(kinds(state)).toEqual(["notes", "rss"]);
  });

  it("close_left re-activates the reference tab when the active one was dropped", () => {
    const state = reduce(
      strip(),
      { type: "activate", id: TRANSLATE_TAB_ID },
      { type: "close_left", id: NOTES_TAB_ID },
    );

    expect(kinds(state)).toEqual(["notes", "rss"]);
    expect(state.activeId).toBe(NOTES_TAB_ID);
    expect(selectActiveKind(state)).toBe("notes");
  });

  it("close_right drops the tabs right of the reference tab", () => {
    const state = reduce(strip(), { type: "close_right", id: FAVORITES_TAB_ID });

    expect(kinds(state)).toEqual(["translate", "favorites"]);
  });

  it("close_right re-activates the reference tab when the active one was dropped", () => {
    const state = reduce(
      strip(),
      { type: "activate", id: RSS_TAB_ID },
      { type: "close_right", id: FAVORITES_TAB_ID },
    );

    expect(kinds(state)).toEqual(["translate", "favorites"]);
    expect(state.activeId).toBe(FAVORITES_TAB_ID);
  });

  it("close_others keeps only the reference tab and activates it", () => {
    const state = reduce(strip(), { type: "close_others", id: NOTES_TAB_ID });

    expect(kinds(state)).toEqual(["notes"]);
    expect(state.activeId).toBe(NOTES_TAB_ID);
    expect(selectIsOpen(state)).toBe(true);
  });

  it("close_others never collapses the panel", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "notes" },
      { type: "close_others", id: NOTES_TAB_ID },
    );

    expect(state.mode).not.toBe("closed");
  });
});

describe("panelTabs selectors", () => {
  it("reports a closed strip with no active tab", () => {
    const state = createPanelTabsState();

    expect(selectIsOpen(state)).toBe(false);
    expect(selectHasTabs(state)).toBe(false);
    expect(selectActiveTab(state)).toBe(null);
    expect(selectActiveKind(state)).toBe(null);
  });

  it("hides the active kind while the panel is collapsed", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "context" },
      { type: "set_mode", mode: "closed" },
    );

    expect(selectHasTabs(state)).toBe(true);
    expect(selectActiveTab(state)?.kind).toBe("context");
    expect(selectActiveKind(state)).toBe(null);
  });

  it("allows set_mode to downgrade on purpose", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "kanban" },
      { type: "set_mode", mode: "normal" },
    );

    expect(state.mode).toBe("normal");
  });

  it("gates the expand button per layout mode", () => {
    const closed = createPanelTabsState();
    const openNoTabs = { ...createPanelTabsState(), mode: "normal" as const };
    const openWithTabs = reduce(createPanelTabsState(), { type: "open", kind: "kanban" });

    // Agentic: only visible once the strip actually has tabs.
    expect(selectCanExpand(closed, "agentic")).toBe(false);
    expect(selectCanExpand(openNoTabs, "agentic")).toBe(false);
    expect(selectCanExpand(openWithTabs, "agentic")).toBe(true);

    // Classic: visible whenever the panel is open.
    expect(selectCanExpand(closed, "classic")).toBe(false);
    expect(selectCanExpand(openNoTabs, "classic")).toBe(true);
    expect(selectCanExpand(openWithTabs, "classic")).toBe(true);
  });
});

describe("panelTabs registry", () => {
  const DELETED_PANEL_KINDS = ["canvas", "json"];

  it("declares a label key for every spec", () => {
    for (const spec of PANEL_TAB_SPECS) {
      expect(spec.labelKey).toBeTruthy();
      if (spec.command) {
        expect(spec.command.labelKey).toBeTruthy();
        expect(spec.command.keywords.length).toBeGreaterThan(0);
        for (const keyword of spec.command.keywords) expect(keyword).toBeTruthy();
      }
    }
  });

  it("gives every spec a unique tab id", () => {
    const ids = PANEL_TAB_SPECS.map((spec) => spec.tabId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z]+:global$/);
  });

  it("does not resurrect deleted panels", () => {
    for (const deleted of DELETED_PANEL_KINDS) {
      expect(PANEL_TAB_KINDS as readonly string[]).not.toContain(deleted);
      expect(PANEL_TAB_SPECS.some((spec) => spec.tabId.startsWith(`${deleted}:`))).toBe(false);
    }
  });

  it("covers exactly the panel views the shell knows about", () => {
    expect([...PANEL_TAB_KINDS].sort()).toEqual(
      [
        "btw",
        "context",
        "conversationTree",
        "favorites",
        "gitDiff",
        "githubTrending",
        "kanban",
        "llmAudit",
        "notes",
        "plans",
        "rss",
        "tokens",
        "toolCalls",
        "translate",
      ].sort(),
    );
  });

  it("marks session-bound panels and only expands kanban by default", () => {
    const sessionBound = PANEL_TAB_SPECS.filter((spec) => spec.sessionBound).map((spec) => spec.kind);
    expect([...sessionBound].sort()).toEqual(
      ["btw", "context", "conversationTree", "gitDiff", "llmAudit", "toolCalls"].sort(),
    );

    const expanded = PANEL_TAB_SPECS.filter((spec) => spec.defaultMode === "expanded").map((spec) => spec.kind);
    expect(expanded).toEqual(["kanban"]);
  });
});

describe("panelTabs file-deletion cascade", () => {
  it("closes the deleted file's tab and every tab under the deleted directory", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open_file", path: "/repo/src/a.ts", label: "a.ts" },
      { type: "open_file", path: "/repo/src/nested/b.ts", label: "b.ts" },
      { type: "open_file", path: "/repo/src/keep.ts", label: "keep.ts" },
      { type: "open", kind: "translate" },
      { type: "close_files_under", path: "/repo/src" },
    );

    expect(kinds(state)).toEqual(["translate"]);
    expect(state.activeId).toBe("translate:global");
    expect(selectIsOpen(state)).toBe(true);
  });

  it("closes only an exact match when a file, not a directory, was deleted", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open_file", path: "/repo/src/a.ts", label: "a.ts" },
      { type: "open_file", path: "/repo/src/a.ts.bak", label: "a.ts.bak" },
      { type: "close_files_under", path: "/repo/src/a.ts" },
    );

    expect(kinds(state)).toEqual(["file"]);
    expect(state.tabs[0].id).toBe(fileTabId("/repo/src/a.ts.bak"));
  });

  it("collapses the strip when the cascade removes every tab", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open_file", path: "/repo/src/a.ts", label: "a.ts" },
      { type: "open_file", path: "/repo/src/b.ts", label: "b.ts" },
      { type: "open_file", path: "/repo/src/c.ts", label: "c.ts" },
      // Newest-first: c, b, a — c is active and gets closed by the cascade.
      { type: "close_files_under", path: "/repo/src" },
    );

    expect(state.tabs).toEqual([]);
    expect(state.activeId).toBe(null);
    expect(state.mode).toBe("closed");
  });

  it("ignores a path that no open tab matches", () => {
    const before = reduce(
      createPanelTabsState(),
      { type: "open_file", path: "/repo/keep.ts", label: "keep.ts" },
    );
    const after = reduce(before, { type: "close_files_under", path: "/repo/gone" });

    expect(after).toBe(before);
  });
});

describe("panelTabs open count selector", () => {
  it("reports 0 for a view that was never opened and the re-open count otherwise", () => {
    const once = reduce(createPanelTabsState(), { type: "open", kind: "gitDiff" });
    const twice = reduce(once, { type: "open", kind: "gitDiff" });

    expect(selectOpenCount(twice, "tokens")).toBe(0);
    expect(selectOpenCount(once, "gitDiff")).toBe(1);
    expect(selectOpenCount(twice, "gitDiff")).toBe(2);
  });
});

describe("panelTabs registry ↔ right-bar presentation", () => {
  it("has exactly one presentation entry per panel view kind", () => {
    const descriptorKinds = RIGHT_BAR_DESCRIPTORS
      .map((desc) => desc.panelKind)
      .filter((kind): kind is NonNullable<typeof kind> => kind !== undefined)
      .sort();

    expect(descriptorKinds).toEqual([...PANEL_TAB_KINDS].sort());
  });

  it("keeps the right-bar default order aligned with the registry", () => {
    expect([...RIGHT_BAR_BUTTON_IDS]).toEqual([...PANEL_TAB_KINDS]);
  });

  it("gives every command-bearing spec a palette icon from the same entry", () => {
    for (const spec of PANEL_TAB_SPECS) {
      if (!spec.command) continue;
      expect(PANEL_COMMAND_ICON_BY_KIND[spec.kind]).toBeTruthy();
    }
  });

  it("shares one glyph per kind between the tab strip and its right-bar button", () => {
    // The tab strip no longer keeps its own icon chain: it reads the same
    // descriptor entry the button column renders, so the two can't drift.
    for (const kind of PANEL_TAB_KINDS) {
      const buttonId = PANEL_BUTTON_ID_BY_KIND[kind];
      expect(RIGHT_BAR_DESCRIPTOR_BY_ID.get(buttonId)?.icon).toBe(PANEL_TAB_ICON_BY_KIND[kind]);
    }
  });

  it("renders a truthy glyph for every panel kind", () => {
    for (const kind of PANEL_TAB_KINDS) {
      const element = PANEL_TAB_ICON_BY_KIND[kind]({ size: 13, active: false }) as {
        type?: unknown;
      } | null;
      expect(element).toBeTruthy();
      expect(element?.type).toBeTruthy();
    }
  });

  it("resolves a non-empty button body for every descriptor from its glyph", () => {
    const ctx: RightBarCtx = {
      rightPanelState: "normal",
      activeTabKind: null,
      selectedSessionId: null,
      selectedCwd: null,
      rssUnread: 0,
      toolStats: { runningCount: 0, totalCount: 0 },
      t: (key) => key,
      toggleRightPanel: () => {},
      togglePanel: () => {},
    };
    for (const desc of RIGHT_BAR_DESCRIPTORS) {
      expect(resolveButtonContent(desc, ctx)).toBeTruthy();
    }
  });

  it("derives exactly one right-bar button id per panel kind", () => {
    const ids = PANEL_TAB_KINDS.map((kind) => PANEL_BUTTON_ID_BY_KIND[kind]);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(panelButtonIdForKind("file")).toBe(null);
  });
});

// ── Registry → command palette ─────────────────────────────────────────
// #7: the palette's panel entries are generated from the registry's opt-in
// `command` declarations. These tests pin the derived side, so re-adding a
// hand-written palette entry (or silently giving a panel one it never had)
// fails here instead of shipping.

describe("panelTabs registry → command palette", () => {
  const panelCommands = (ctx: CommandContext) =>
    buildCommands(ctx, (key) => key).filter((cmd) => cmd.group === "Panel");

  function commandCtx(overrides: Partial<CommandContext> = {}): CommandContext {
    return {
      setTheme: () => {},
      setLocale: () => {},
      newSession: () => {},
      openSettings: () => {},
      openCwdPicker: () => {},
      openModels: () => {},
      openSkills: () => {},
      openPrompts: () => {},
      openScheduler: () => {},
      openChannels: () => {},
      openToolMarket: () => {},
      toggleSidebar: () => {},
      toggleRightPanel: () => {},
      togglePanel: () => {},
      agentControls: null,
      hasSession: false,
      hasCwd: false,
      ...overrides,
    };
  }

  const optInKinds = PANEL_TAB_SPECS.filter((spec) => spec.command).map(
    (spec) => spec.kind,
  );

  it("generates one command per opt-in spec, in registry order", () => {
    expect(panelCommands(commandCtx()).map((cmd) => cmd.id)).toEqual(
      optInKinds.map((kind) => `panel.${kind}`),
    );
  });

  it("keeps the palette down to exactly the seven panels that declare an entry", () => {
    // Output-side pin: an eighth panel gaining a palette entry (or one of
    // these losing one) fails here, not just in the registry declaration.
    expect(
      panelCommands(commandCtx())
        .map((cmd) => cmd.id)
        .sort(),
    ).toEqual(
      ["favorites", "gitDiff", "llmAudit", "plans", "tokens", "toolCalls", "translate"]
        .map((kind) => `panel.${kind}`)
        .sort(),
    );
  });

  it("titles and keywords come from the spec, not from the call site", () => {
    const specs = PANEL_TAB_SPECS.filter((spec) => spec.command);
    const commands = panelCommands(commandCtx());

    expect(commands.map((cmd) => cmd.title)).toEqual(
      specs.map((spec) => spec.command!.labelKey),
    );
    expect(commands.map((cmd) => cmd.keywords)).toEqual(
      specs.map((spec) => [...spec.command!.keywords]),
    );
    // Fresh arrays: a mutated command entry must not write back into the
    // shared registry declaration.
    commands.forEach((cmd, index) => {
      expect(cmd.keywords).not.toBe(specs[index].command!.keywords);
    });
  });

  it("routes every palette entry through the shared toggle rule", () => {
    const toggled: PanelViewKind[] = [];
    const ctx = commandCtx({ togglePanel: (kind) => toggled.push(kind) });

    // Run the whole palette, not just the Panel group: a hand-written entry
    // that opens a panel from any group (the regression this issue deletes)
    // shows up as an extra togglePanel call here.
    for (const cmd of buildCommands(ctx, (key) => key)) cmd.run(ctx);

    expect(toggled).toEqual(optInKinds);
  });
});
