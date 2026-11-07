import { describe, expect, it } from "vitest";
import {
  GIT_DIFF_TAB_ID,
  LLM_AUDIT_TAB_ID,
  MCP_TAB_ID,
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
  selectTabByKind,
  type PanelTabsAction,
  type PanelTabsState,
  type PanelViewKind,
} from "@/lib/shared/panelTabs";
import { buildCommands, type CommandContext } from "@/lib/client/commands";
import { type MainViewKind } from "@/lib/shared/mainView";
import {
  PANEL_COMMAND_ICON_BY_KIND,
  PANEL_TAB_ICON_BY_KIND,
  RIGHT_BAR_BUTTON_IDS,
  RIGHT_BAR_DESCRIPTOR_BY_ID,
  RIGHT_BAR_DESCRIPTORS,
  type RightBarCtx,
} from "@/components/panels/right-bar/desc";

function reduce(state: PanelTabsState, ...actions: PanelTabsAction[]): PanelTabsState {
  return actions.reduce(panelTabsReducer, state);
}

function kinds(state: PanelTabsState): string[] {
  return state.tabs.map((tab) => tab.kind);
}

function openCount(state: PanelTabsState, id: string): number | undefined {
  return state.tabs.find((tab) => tab.id === id)?.openCount;
}

describe("selectTabByKind", () => {
  it("finds no panel tab for a main view kind", () => {
    const state = reduce(createPanelTabsState(), { type: "open", kind: "translate" });

    expect(selectTabByKind(state, "scheduler")).toBe(null);
    expect(selectTabByKind(state, "translate")?.kind).toBe("translate");
  });
});

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
      { type: "open", kind: "llmAudit" },
      { type: "open", kind: "translate" },
    );

    expect(kinds(state)).toEqual(["llmAudit", "translate"]);
    expect(selectActiveKind(state)).toBe("translate");
  });

  it("bumps openCount on every open, including re-opens", () => {
    const once = reduce(createPanelTabsState(), { type: "open", kind: "gitDiff" });
    const twice = reduce(once, { type: "open", kind: "gitDiff" });

    expect(openCount(once, GIT_DIFF_TAB_ID)).toBe(1);
    expect(openCount(twice, GIT_DIFF_TAB_ID)).toBe(2);
  });

  it("only upgrades the panel mode, never downgrades it", () => {
    const expanded = reduce(
      createPanelTabsState(),
      { type: "open", kind: "translate" },
      { type: "set_mode", mode: "expanded" },
    );
    expect(expanded.mode).toBe("expanded");

    expect(reduce(createPanelTabsState(), { type: "open", kind: "llmAudit" }).mode).toBe("normal");

    expect(reduce(expanded, { type: "open", kind: "llmAudit" }).mode).toBe("expanded");

    expect(reduce(expanded, { type: "open", kind: "translate" }).mode).toBe("expanded");
  });

  it("keeps file preview tabs and panel view tabs in one strip", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "translate" },
      { type: "open_file", path: "/tmp/a.md", label: "a.md" },
    );

    expect(kinds(state)).toEqual(["file", "translate"]);
    expect(state.tabs[0].id).toBe(fileTabId("/tmp/a.md"));
    expect(state.tabs[0].label).toBe("a.md");
    expect(selectActiveKind(state)).toBe("file");
    expect(state.mode).toBe("normal");
  });

  it("reuses an already open file tab and bumps its openCount", () => {
    const path = "/tmp/a.md";
    const state = reduce(
      createPanelTabsState(),
      { type: "open_file", path, label: "a.md" },
      { type: "open", kind: "translate" },
      { type: "open_file", path, label: "a.md" },
    );

    expect(kinds(state)).toEqual(["translate", "file"]);
    expect(openCount(state, fileTabId(path))).toBe(2);
    expect(selectActiveKind(state)).toBe("file");
  });
});

describe("panelTabs toggle", () => {
  it("opens the panel when its tab is not active", () => {
    const state = reduce(createPanelTabsState(), { type: "toggle", kind: "gitDiff" });

    expect(selectIsOpen(state)).toBe(true);
    expect(selectActiveKind(state)).toBe("gitDiff");
    expect(openCount(state, GIT_DIFF_TAB_ID)).toBe(1);
  });

  it("collapses the panel when the toggled tab is active and the panel is open", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "gitDiff" },
      { type: "toggle", kind: "gitDiff" },
    );

    expect(kinds(state)).toEqual(["gitDiff"]);
    expect(state.mode).toBe("closed");
    expect(selectIsOpen(state)).toBe(false);
    expect(selectActiveKind(state)).toBe(null);
  });

  it("reopens an already open tab whose panel was collapsed", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "gitDiff" },
      { type: "set_mode", mode: "closed" },
      { type: "toggle", kind: "gitDiff" },
    );

    expect(state.mode).toBe("normal");
    expect(openCount(state, GIT_DIFF_TAB_ID)).toBe(2);
  });

  it("toggles a different panel view instead of collapsing the active one", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "gitDiff" },
      { type: "toggle", kind: "translate" },
    );

    expect(state.mode).toBe("normal");
    expect(selectActiveKind(state)).toBe("translate");
  });
});

describe("panelTabs close", () => {
  it("falls back to the oldest remaining tab when the active one closes", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "mcp" },
      { type: "open", kind: "translate" },
      { type: "open", kind: "llmAudit" },
      { type: "close", id: LLM_AUDIT_TAB_ID },
    );

    expect(kinds(state)).toEqual(["translate", "mcp"]);
    expect(selectActiveKind(state)).toBe("mcp");
    expect(state.mode).not.toBe("closed");
  });

  it("keeps the active tab when a background tab closes", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "mcp" },
      { type: "open", kind: "translate" },
      { type: "close", id: MCP_TAB_ID },
    );

    expect(selectActiveKind(state)).toBe("translate");
  });

  it("collapses the strip when the last tab closes", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "llmAudit" },
      { type: "set_mode", mode: "expanded" },
      { type: "close", id: LLM_AUDIT_TAB_ID },
    );

    expect(state.tabs).toEqual([]);
    expect(state.activeId).toBe(null);
    expect(state.mode).toBe("closed");
  });

  it("ignores a close of an unknown tab", () => {
    const before = reduce(createPanelTabsState(), { type: "open", kind: "llmAudit" });
    const after = reduce(before, { type: "close", id: "file:/tmp/gone.md" });

    expect(after).toEqual(before);
  });
});

describe("panelTabs batch close", () => {
  function strip(): PanelTabsState {
    return reduce(
      createPanelTabsState(),
      { type: "open", kind: "gitDiff" },
      { type: "open", kind: "llmAudit" },
      { type: "open", kind: "mcp" },
      { type: "open", kind: "translate" },
    );
  }

  it("close_left drops the tabs left of the reference tab", () => {
    const state = reduce(strip(), { type: "close_left", id: LLM_AUDIT_TAB_ID });

    expect(kinds(state)).toEqual(["llmAudit", "gitDiff"]);
  });

  it("close_left re-activates the reference tab when the active one was dropped", () => {
    const state = reduce(
      strip(),
      { type: "activate", id: TRANSLATE_TAB_ID },
      { type: "close_left", id: LLM_AUDIT_TAB_ID },
    );

    expect(kinds(state)).toEqual(["llmAudit", "gitDiff"]);
    expect(state.activeId).toBe(LLM_AUDIT_TAB_ID);
    expect(selectActiveKind(state)).toBe("llmAudit");
  });

  it("close_right drops the reference tab and the ones left of it", () => {
    const state = reduce(strip(), { type: "close_right", id: LLM_AUDIT_TAB_ID });

    expect(kinds(state)).toEqual(["translate", "mcp", "llmAudit"]);
  });

  it("close_right re-activates the reference tab when the active one was dropped", () => {
    const state = reduce(
      strip(),
      { type: "activate", id: GIT_DIFF_TAB_ID },
      { type: "close_right", id: MCP_TAB_ID },
    );

    expect(kinds(state)).toEqual(["translate", "mcp"]);
    expect(state.activeId).toBe(MCP_TAB_ID);
  });

  it("close_others keeps only the reference tab and activates it", () => {
    const state = reduce(strip(), { type: "close_others", id: LLM_AUDIT_TAB_ID });

    expect(kinds(state)).toEqual(["llmAudit"]);
    expect(state.activeId).toBe(LLM_AUDIT_TAB_ID);
    expect(selectIsOpen(state)).toBe(true);
  });

  it("close_others never collapses the panel", () => {
    const state = reduce(
      createPanelTabsState(),
      { type: "open", kind: "llmAudit" },
      { type: "close_others", id: LLM_AUDIT_TAB_ID },
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
      { type: "open", kind: "llmAudit" },
      { type: "set_mode", mode: "normal" },
    );

    expect(state.mode).toBe("normal");
  });

  it("gates the expand button on the open strip having tabs", () => {
    const closed = createPanelTabsState();
    const openNoTabs = { ...createPanelTabsState(), mode: "normal" as const };
    const openWithTabs = reduce(createPanelTabsState(), { type: "open", kind: "llmAudit" });

    expect(selectCanExpand(closed)).toBe(false);
    expect(selectCanExpand(openNoTabs)).toBe(false);
    expect(selectCanExpand(openWithTabs)).toBe(true);
  });
});

describe("panelTabs registry", () => {
  const DELETED_PANEL_KINDS = [
    "canvas",
    "json",
    "githubTrending",
    "toolCalls",
    "btw",
    "notes",
    "plans",
    "kanban",
  ];

  it("declares a label key and keywords for every spec and palette entry", () => {
    for (const spec of PANEL_TAB_SPECS) {
      expect(spec.labelKey).toBeTruthy();
      for (const entry of spec.commands ?? []) {
        expect(entry.labelKey).toBeTruthy();
        expect(entry.keywords.length).toBeGreaterThan(0);
        for (const keyword of entry.keywords) expect(keyword).toBeTruthy();
        expect(entry.id ?? "").not.toContain(".");
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
        "context",
        "conversationTree",
        "gitDiff",
        "llmAudit",
        "mcp",
        "translate",
      ].sort(),
    );
  });

  it("registers the MCP panel as a session-bound button after LLM audit", () => {
    const order = PANEL_TAB_KINDS as readonly string[];
    const mcp = PANEL_TAB_SPECS.find((spec) => spec.kind === "mcp");

    expect(mcp?.tabId).toBe(MCP_TAB_ID);
    expect(mcp?.labelKey).toBe("mcp.title");
    expect(mcp?.sessionBound).toBe(true);
    expect(mcp?.commands?.[0]?.labelKey).toBe("mcp.open");
    expect(mcp?.commands?.[0]?.keywords).toEqual(
      expect.arrayContaining(["mcp", "servers", "model context protocol", "服务器", "工具"]),
    );
    expect(order.indexOf("mcp")).toBe(order.indexOf("llmAudit") + 1);
  });

  it("no longer carries main views", () => {
    for (const kind of ["scheduler", "modelsConfig", "skills", "channels", "memory", "tokens"]) {
      expect(PANEL_TAB_KINDS as readonly string[]).not.toContain(kind);
      expect(RIGHT_BAR_BUTTON_IDS as readonly string[]).not.toContain(kind);
      expect((RIGHT_BAR_DESCRIPTOR_BY_ID as ReadonlyMap<string, unknown>).has(kind)).toBe(false);
      expect(Object.keys(PANEL_COMMAND_ICON_BY_KIND)).not.toContain(kind);
    }
  });

  it("marks session-bound panels and declares no expanded default", () => {
    const sessionBound = PANEL_TAB_SPECS.filter((spec) => spec.sessionBound).map((spec) => spec.kind);
    expect([...sessionBound].sort()).toEqual(
      ["context", "conversationTree", "gitDiff", "llmAudit", "mcp"].sort(),
    );

    const expanded = PANEL_TAB_SPECS.filter((spec) => spec.defaultMode === "expanded").map((spec) => spec.kind);
    expect(expanded).toEqual([]);
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

    expect(selectOpenCount(twice, "context")).toBe(0);
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
      if (!spec.commands?.length) continue;
      expect(PANEL_COMMAND_ICON_BY_KIND[spec.kind]).toBeTruthy();
    }
  });

  it("shares one glyph per kind between the tab strip and its right-bar button", () => {
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

  function barCtx(overrides: Partial<RightBarCtx> = {}): RightBarCtx {
    return {
      rightPanelState: "normal",
      activeTabKind: null,
      selectedSessionId: null,
      selectedCwd: null,
      mcpDirty: false,
      t: (key) => key,
      toggleRightPanel: () => {},
      togglePanel: () => {},
      ...overrides,
    };
  }

  it("resolves a truthy glyph for every descriptor", () => {
    const ctx = barCtx();
    for (const desc of RIGHT_BAR_DESCRIPTORS) {
      expect(desc.icon({ size: 16, active: desc.isActive(ctx) })).toBeTruthy();
    }
  });

  it("badges the MCP button while any cwd holds an unsaved draft", () => {
    const descriptor = RIGHT_BAR_DESCRIPTOR_BY_ID.get("mcp");

    expect(descriptor?.badge?.(barCtx({ rightPanelState: "closed" }))).toBeFalsy();
    expect(descriptor?.badge?.(barCtx({ rightPanelState: "closed", mcpDirty: true }))).toBeTruthy();
    expect(descriptor?.badge?.(barCtx({ mcpDirty: true }))).toBeTruthy();
  });

  it("routes the MCP badge through the shared corner-dot hook", () => {
    const mcpDirty = RIGHT_BAR_DESCRIPTOR_BY_ID.get("mcp")?.badge?.(barCtx({ mcpDirty: true }));

    const rendered = (
      mcpDirty as unknown as { type: () => { props: { style: Record<string, unknown> } } }
    ).type();
    expect(rendered.props.style.borderRadius).toBe("50%");
  });

  it("derives exactly one right-bar button id per panel kind", () => {
    const ids = PANEL_TAB_KINDS.map((kind) => PANEL_BUTTON_ID_BY_KIND[kind]);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(panelButtonIdForKind("file")).toBe(null);
  });
});

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
      toggleSidebar: () => {},
      toggleRightPanel: () => {},
      togglePanel: () => {},
      enterMainView: () => {},
      agentControls: null,
      hasSession: false,
      ...overrides,
    };
  }

  const optInCommands = PANEL_TAB_SPECS.flatMap((spec) =>
    (spec.commands ?? []).map((entry) => ({
      id: entry.id ? `panel.${spec.kind}.${entry.id}` : `panel.${spec.kind}`,
      kind: spec.kind,
      labelKey: entry.labelKey,
      keywords: entry.keywords,
    })),
  );

  it("generates one command per opt-in entry, in registry order", () => {
    expect(panelCommands(commandCtx()).map((cmd) => cmd.id)).toEqual(
      optInCommands.map((entry) => entry.id),
    );
  });

  it("keeps the generated palette ids unique", () => {
    const ids = panelCommands(commandCtx()).map((cmd) => cmd.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the palette down to exactly the entries the registry declares", () => {
    expect(
      panelCommands(commandCtx())
        .map((cmd) => cmd.id)
        .sort(),
    ).toEqual(
      [
        "panel.gitDiff",
        "panel.llmAudit",
        "panel.mcp",
        "panel.translate",
      ].sort(),
    );
  });

  it("reaches models config through the main view registry, entering instead of toggling", () => {
    const entered: MainViewKind[] = [];
    const toggled: PanelViewKind[] = [];
    const ctx = commandCtx({
      enterMainView: (kind) => entered.push(kind),
      togglePanel: (kind) => toggled.push(kind),
    });

    const commands = buildCommands(ctx, (key) => key).filter(
      (cmd) => cmd.title === "Open models config",
    );

    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe("mainView.modelsConfig");
    expect(commands[0].keywords).toEqual(expect.arrayContaining(["模型", "配置", "服务商"]));

    for (const cmd of commands) cmd.run(ctx);

    expect(entered).toEqual(["modelsConfig"]);
    expect(toggled).toEqual([]);
  });

  it("reaches skills through the main view registry, entering instead of toggling", () => {
    const entered: MainViewKind[] = [];
    const toggled: PanelViewKind[] = [];
    const ctx = commandCtx({
      enterMainView: (kind) => entered.push(kind),
      togglePanel: (kind) => toggled.push(kind),
    });

    const commands = buildCommands(ctx, (key) => key).filter(
      (cmd) => cmd.id === "mainView.skills",
    );

    expect(commands).toHaveLength(1);
    expect(commands[0].title).toBe("Open skills");
    expect(commands[0].keywords).toEqual(expect.arrayContaining(["skills", "技能", "扩展"]));

    for (const cmd of commands) cmd.run(ctx);

    expect(entered).toEqual(["skills"]);
    expect(toggled).toEqual([]);
  });

  it("titles and keywords come from the spec, not from the call site", () => {
    const commands = panelCommands(commandCtx());

    expect(commands.map((cmd) => cmd.title)).toEqual(
      optInCommands.map((entry) => entry.labelKey),
    );
    expect(commands.map((cmd) => cmd.keywords)).toEqual(
      optInCommands.map((entry) => [...entry.keywords]),
    );
    commands.forEach((cmd, index) => {
      expect(cmd.keywords).not.toBe(optInCommands[index].keywords);
    });
  });

  it("reaches scheduled tasks through the main view registry, entering instead of toggling", () => {
    const entered: MainViewKind[] = [];
    const toggled: PanelViewKind[] = [];
    const ctx = commandCtx({
      enterMainView: (kind) => entered.push(kind),
      togglePanel: (kind) => toggled.push(kind),
    });

    const commands = buildCommands(ctx, (key) => key).filter(
      (cmd) => cmd.title === "Open scheduled tasks",
    );

    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe("mainView.scheduler");
    expect(commands[0].keywords).toEqual(expect.arrayContaining(["scheduler", "定时任务"]));

    for (const cmd of commands) cmd.run(ctx);

    expect(entered).toEqual(["scheduler"]);
    expect(toggled).toEqual([]);
  });

  it("reaches channels through the main view registry, entering instead of toggling", () => {
    const entered: MainViewKind[] = [];
    const toggled: PanelViewKind[] = [];
    const ctx = commandCtx({
      enterMainView: (kind) => entered.push(kind),
      togglePanel: (kind) => toggled.push(kind),
    });

    const commands = buildCommands(ctx, (key) => key).filter(
      (cmd) => cmd.title === "Open channels",
    );

    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe("mainView.channels");

    for (const cmd of commands) cmd.run(ctx);

    expect(entered).toEqual(["channels"]);
    expect(toggled).toEqual([]);
  });

  it("reaches memory and token usage through the main view registry, entering instead of toggling", () => {
    const entered: MainViewKind[] = [];
    const toggled: PanelViewKind[] = [];
    const ctx = commandCtx({
      enterMainView: (kind) => entered.push(kind),
      togglePanel: (kind) => toggled.push(kind),
    });

    const commands = buildCommands(ctx, (key) => key).filter(
      (cmd) => cmd.title === "Open memory" || cmd.title === "Open token audit",
    );

    expect(commands.map((cmd) => cmd.id)).toEqual(["mainView.memory", "mainView.tokens"]);

    for (const cmd of commands) cmd.run(ctx);

    expect(entered).toEqual(["memory", "tokens"]);
    expect(toggled).toEqual([]);
  });

  it("routes every palette entry through the shared panel toggle rule", () => {
    const toggled: PanelViewKind[] = [];
    const ctx = commandCtx({ togglePanel: (kind) => toggled.push(kind) });

    for (const cmd of buildCommands(ctx, (key) => key)) cmd.run(ctx);

    expect(toggled).toEqual(optInCommands.map((entry) => entry.kind));
  });
});
