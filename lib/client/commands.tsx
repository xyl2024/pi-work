"use client";

import type { ReactNode } from "react";
import type { ThemePreset } from "@/hooks/useTheme";
import { PRESETS } from "@/hooks/useTheme";
import type { Locale } from "@/hooks/useI18n";
import { flippedPermissionMode, type PermissionMode } from "@/lib/shared/permission-mode";
import { ICONS } from "@/components/ui/icons";
import { PANEL_TAB_SPECS, type PanelViewKind } from "@/lib/shared/panelTabs";
import {
  Languages,
  LetterText,
  PanelRight,
  FolderOpen,
} from "lucide-react";

// ── AgentControls ────────────────────────────────────────────────────────
// Imperative controls owned by useAgentSession (inside ChatWindow). ChatWindow
// registers them on mount via setAgentControls() in sessionUiStore; AppShell
// reads them via useAgentControls() and threads them into CommandContext.
// `null` when no ChatWindow is mounted (no active session).

export interface AgentControls {
  abortStreaming: () => void | Promise<void>;
  isStreaming: boolean;
  /** The active session's permission mode (ADR-0021). Absent when no session
   *  exists yet — a draft is always `confirm`, and a palette entry that cannot
   *  do anything is worse than no entry. */
  permissionMode?: PermissionMode;
  /** Flip it. Same handler the toolbar shield calls, not a second path. */
  setPermissionMode?: (mode: PermissionMode) => void | Promise<void>;
}

// ── Icons ────────────────────────────────────────────────────────────────
// 16×16 inline SVGs in the project's house style: stroke 2, currentColor,
// round caps. One component per icon so commands can keep `icon: <PlusIcon />`.

const PlusIcon = ICONS.plus;
const StopIcon = ICONS.stop;
const SunIcon = ICONS.sun;
const MoonIcon = ICONS.moon;
const SidebarIcon = ICONS.sidebar;
const GearIcon = ICONS.gear;
const ShieldIcon = ICONS.shield;

// Keep the right-panel toggle command icon identical to the right-bar
// descriptor's.
const RightPanelIcon = () => <PanelRight size={16} />;
const CwdPickerIcon = () => <FolderOpen size={16} />;
const EnglishLanguageIcon = () => <LetterText size={16} />;
const ChineseLanguageIcon = () => <Languages size={16} />;

// Theme icons: light → sun, dark → moon.
const ThemeIcon = ({ preset }: { preset: ThemePreset }) => {
  return preset === "dark" ? <MoonIcon /> : <SunIcon />;
};

// ── CommandGroup ─────────────────────────────────────────────────────────
// Order matters — empty-state renders groups top-to-bottom in this sequence.

export const COMMAND_GROUPS = [
  "Session",
  "Theme",
  "View",
  "Panel",
  "Modal",
  "Language",
] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number];

// ── Command ──────────────────────────────────────────────────────────────

export interface Command {
  id: string;
  title: string;          // already resolved via t() at build time
  group: CommandGroup;
  keywords?: string[];    // English-only, used for fuzzy matching
  icon: ReactNode;
  shortcut?: string;      // display-only
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

// ── CommandContext ───────────────────────────────────────────────────────
// Everything a command might call. Built by AppShell and passed into
// buildCommands() then into CommandPalette. Re-creating the object is fine
// — CommandPalette is unmounted while it's being re-created, and the
// commands are filtered/sorted per build.

export interface CommandContext {
  // Theme / language
  setTheme: (preset: ThemePreset) => void;
  setLocale: (locale: Locale) => void;

  // Session lifecycle
  newSession: () => void;

  // Modal openers
  openSettings: () => void;
  openCwdPicker: () => void;

  // View toggles
  toggleSidebar: () => void;
  toggleRightPanel: () => void;

  /** The single panel toggle rule, shared by the right-bar buttons and the
   *  generated panel commands: reveal the view, or collapse the panel when
   *  it is already the active open tab. */
  togglePanel: (kind: PanelViewKind) => void;

  // Imperative agent controls — null when no ChatWindow is mounted.
  agentControls: AgentControls | null;

  // Cwd/session presence for when() predicates.
  hasSession: boolean;
}

// ── buildCommands ────────────────────────────────────────────────────────

/**
 * Panel commands generated from the panel registry instead of hand-written
 * entries: only specs that opt in (`spec.commands`) get any, and each one
 * routes through the same panel toggle rule as the right-bar button.
 */
function buildPanelCommands(
  ctx: CommandContext,
  t: (key: string) => string,
  icons: Partial<Record<PanelViewKind, ReactNode>>,
): Command[] {
  return PANEL_TAB_SPECS.flatMap((spec): Command[] =>
    (spec.commands ?? []).map((entry) => ({
      // `panel.<kind>` is the view's own entry; extra entries carry an id.
      id: entry.id ? `panel.${spec.kind}.${entry.id}` : `panel.${spec.kind}`,
      title: t(entry.labelKey),
      group: "Panel",
      keywords: [...entry.keywords],
      icon: icons[spec.kind] ?? null,
      run: () => ctx.togglePanel(spec.kind),
    })),
  );
}

export function buildCommands(
  ctx: CommandContext,
  t: (key: string) => string,
  panelIcons: Partial<Record<PanelViewKind, ReactNode>> = {},
): Command[] {
  const cmds: Command[] = [];

  // ── Session ──
  cmds.push({
    id: "session.new",
    title: t("New session"),
    group: "Session",
    keywords: ["session", "chat", "new", "create", "新建", "会话"],
    icon: <PlusIcon />,
    run: () => ctx.newSession(),
  });

  cmds.push({
    id: "session.change_project",
    title: t("Change project"),
    group: "Session",
    keywords: ["cwd", "project", "directory", "folder", "switch", "切换", "项目", "目录", "工作目录"],
    icon: <CwdPickerIcon />,
    run: () => ctx.openCwdPicker(),
  });

  cmds.push({
    id: "session.permission_mode",
    // The title states what the click will DO, so it flips with the state.
    title: ctx.agentControls?.permissionMode === "full_access"
      ? t("Switch to confirm dangerous commands")
      : t("Switch to allow full access"),
    group: "Session",
    keywords: [
      "permission", "permissions", "dangerous", "command", "confirm", "full", "access", "shield", "yolo",
      "权限", "完全访问", "确认", "危险命令",
    ],
    icon: <ShieldIcon />,
    // Only offered once a session exists: `setPermissionMode` is registered by
    // the active ChatWindow only for a real session.
    when: (c) => !!c.agentControls?.setPermissionMode,
    // Closes over `ctx` like every other command: the palette calls `run()` with
    // no argument (each handler captures the context at build time), so reading
    // the context off the parameter would throw on click.
    run: () => ctx.agentControls?.setPermissionMode?.(
      flippedPermissionMode(ctx.agentControls?.permissionMode ?? "confirm"),
    ),
  });

  cmds.push({
    id: "session.abort_streaming",
    title: t("Stop agent"),
    group: "Session",
    keywords: ["stop", "abort", "cancel", "停止", "中止"],
    icon: <StopIcon />,
    when: (c) => !!c.agentControls?.isStreaming,
    run: () => ctx.agentControls?.abortStreaming(),
  });

  // ── Theme (2) ──
  const themeTitleKeys: Record<ThemePreset, string> = {
    light: "Theme: Light",
    dark: "Theme: Dark",
  };
  const themeKeywords: Record<ThemePreset, string[]> = {
    light: ["theme", "light", "bright", "主题", "明亮", "浅色", "白天"],
    dark: ["theme", "dark", "night", "主题", "暗色", "深色", "夜晚"],
  };
  for (const preset of PRESETS) {
    cmds.push({
      id: `theme.${preset}`,
      title: t(themeTitleKeys[preset]),
      group: "Theme",
      keywords: themeKeywords[preset],
      icon: <ThemeIcon preset={preset} />,
      run: () => ctx.setTheme(preset),
    });
  }

  // ── View (3) ──
  cmds.push({
    id: "view.sidebar",
    title: t("Toggle sidebar"),
    group: "View",
    keywords: ["sidebar", "panel", "left", "toggle", "侧边栏", "显示", "隐藏"],
    icon: <SidebarIcon />,
    shortcut: "⌘B",
    run: () => ctx.toggleSidebar(),
  });
  cmds.push({
    id: "view.right_panel",
    title: t("Toggle right panel"),
    group: "View",
    keywords: ["right", "panel", "toggle", "右", "面板"],
    icon: <RightPanelIcon />,
    shortcut: "⌘⌥B",
    run: () => ctx.toggleRightPanel(),
  });
  // ── Panel ──
  // One command per registry spec that opts in; see buildPanelCommands.
  cmds.push(...buildPanelCommands(ctx, t, panelIcons));
  // ── Modal ──
  // Skills and scheduled tasks are not here: they are panel views now, so
  // their palette entries are generated from the panel registry.
  cmds.push({
    id: "modal.settings",
    title: t("Open settings"),
    group: "Modal",
    keywords: ["settings", "preferences", "config", "设置", "偏好", "配置"],
    icon: <GearIcon />,
    run: () => ctx.openSettings(),
  });
  // ── Language (2) ──
  cmds.push({
    id: "lang.en",
    title: t("Language: English"),
    group: "Language",
    keywords: ["language", "english", "en", "语言", "英文"],
    icon: <EnglishLanguageIcon />,
    run: () => ctx.setLocale("en"),
  });
  cmds.push({
    id: "lang.zh",
    title: t("Language: Chinese"),
    group: "Language",
    keywords: ["language", "chinese", "zh", "中文", "语言"],
    icon: <ChineseLanguageIcon />,
    run: () => ctx.setLocale("zh"),
  });

  // Apply when() to filter the empty-state view too.
  return cmds.filter((c) => !c.when || c.when(ctx));
}

// Helper for fuzzy scoring of a single command against a query.
// Returns -1 if the command doesn't match at all; higher scores are better.
export function scoreCommand(cmd: Command, query: string): number {
  if (!query) return 0; // empty query: caller handles non-match separately
  const q = query.toLowerCase();

  // Exact title match wins big.
  if (cmd.title.toLowerCase() === q) return 1000;

  // Title prefix match.
  if (cmd.title.toLowerCase().startsWith(q)) return 500;

  // Title contains.
  const titleLower = cmd.title.toLowerCase();
  if (titleLower.includes(q)) return 200 + (titleLower.indexOf(q) === 0 ? 50 : 0);

  // Keyword exact match.
  for (const k of cmd.keywords ?? []) {
    if (k.toLowerCase() === q) return 400;
  }

  // Fuzzy subsequence match across title + keywords.
  const haystack = [cmd.title.toLowerCase(), ...(cmd.keywords ?? []).map((k) => k.toLowerCase())];
  let best = -1;
  for (const h of haystack) {
    const s = fuzzyScore(h, q);
    if (s > best) best = s;
  }
  return best;
}

// Simple subsequence fuzzy score: returns 0-100 if all query chars appear
// in order, else -1. Consecutive matches score higher; earlier matches too.
function fuzzyScore(haystack: string, needle: string): number {
  let hi = 0;
  let ni = 0;
  let score = 0;
  let prevMatch = -1;
  while (hi < haystack.length && ni < needle.length) {
    if (haystack[hi] === needle[ni]) {
      score += 10;
      if (prevMatch === hi - 1) score += 5; // consecutive bonus
      if (hi < 3) score += 3; // word-start bonus
      prevMatch = hi;
      ni++;
    }
    hi++;
  }
  if (ni < needle.length) return -1;
  // Penalize long haystacks slightly so a longer title doesn't always
  // outrank a shorter one when the query is short.
  score -= Math.floor(haystack.length / 10);
  return score;
}
