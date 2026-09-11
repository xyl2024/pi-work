"use client";

import type { ReactNode } from "react";
import type { ThemePreset } from "@/hooks/useTheme";
import { PRESETS } from "@/hooks/useTheme";
import type { Locale } from "@/hooks/useI18n";
import { ICONS } from "@/components/ui/icons";
import {
  ChartColumn,
  ChartSpline,
  GitGraph,
  Languages,
  LetterText,
  PanelRight,
  FolderOpen,
  Star,
  Store,
  Wrench,
} from "lucide-react";

// ── AgentControls ────────────────────────────────────────────────────────
// Imperative controls owned by useAgentSession (inside ChatWindow). ChatWindow
// registers them on mount via setAgentControls() in sessionUiStore; AppShell
// reads them via useAgentControls() and threads them into CommandContext.
// `null` when no ChatWindow is mounted (no active session).

export interface AgentControls {
  abortStreaming: () => void | Promise<void>;
  isStreaming: boolean;
}

// ── Icons ────────────────────────────────────────────────────────────────
// 16×16 inline SVGs in the project's house style: stroke 2, currentColor,
// round caps. One component per icon so commands can keep `icon: <PlusIcon />`.

const PlusIcon = ICONS.plus;
const StopIcon = ICONS.stop;
const SunIcon = ICONS.sun;
const MoonIcon = ICONS.moon;
const SidebarIcon = ICONS.sidebar;
const GlobeIcon = ICONS.globe;
const GearIcon = ICONS.gear;
const ChipIcon = ICONS.chip;
const SparkleIcon = ICONS.sparkle;
const BookIcon = ICONS.book;

const ClockIcon = ICONS.clock;

// Keep right-panel command icons identical to the right-bar descriptors.
const RightPanelIcon = () => <PanelRight size={16} />;
const FavoritesPanelIcon = () => <Star size={16} />;
const TranslatePanelIcon = () => <Languages size={16} />;
const ToolCallsPanelIcon = () => <Wrench size={16} />;
const TokensPanelIcon = () => <ChartSpline size={16} />;
const GitDiffPanelIcon = () => <GitGraph size={16} />;
const LlmAuditPanelIcon = () => <ChartColumn size={16} />;
const CwdPickerIcon = () => <FolderOpen size={16} />;
const ToolMarketIcon = () => <Store size={16} />;
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
  openModels: () => void;
  openSkills: () => void;
  openPrompts: () => void;
  openScheduler: () => void;
  openChannels: () => void;
  openToolMarket: () => void;

  // Right-panel tabs
  openFavoritesTab: () => void;
  openTranslateTab: () => void;
  openToolCallsTab: () => void;
  openTokensTab: () => void;
  openGitDiffTab: () => void;
  openLlmAuditTab: () => void;

  // View toggles
  toggleSidebar: () => void;
  toggleRightPanel: () => void;

  // Imperative agent controls — null when no ChatWindow is mounted.
  agentControls: AgentControls | null;

  // Cwd/session presence for when() predicates.
  hasSession: boolean;
  hasCwd: boolean;
}

// ── buildCommands ────────────────────────────────────────────────────────

export function buildCommands(ctx: CommandContext, t: (key: string) => string): Command[] {
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
  cmds.push({
    id: "panel.favorites",
    title: t("Open favorites"),
    group: "Panel",
    keywords: ["favorite", "star", "collection", "收藏", "星标"],
    icon: <FavoritesPanelIcon />,
    run: () => ctx.openFavoritesTab(),
  });
  cmds.push({
    id: "panel.translate",
    title: t("Open translate"),
    group: "Panel",
    keywords: ["translate", "translation", "翻译"],
    icon: <TranslatePanelIcon />,
    run: () => ctx.openTranslateTab(),
  });
  cmds.push({
    id: "panel.toolcalls",
    title: t("Open tool calls"),
    group: "Panel",
    keywords: ["tool", "calls", "stats", "工具", "调用", "统计"],
    icon: <ToolCallsPanelIcon />,
    run: () => ctx.openToolCallsTab(),
  });
  cmds.push({
    id: "panel.tokens",
    title: t("Open token audit"),
    group: "Panel",
    keywords: ["tokens", "token", "usage", "audit", "cost", "用量", "审计", "Token"],
    icon: <TokensPanelIcon />,
    run: () => ctx.openTokensTab(),
  });
  cmds.push({
    id: "panel.gitdiff",
    title: t("Open git diff"),
    group: "Panel",
    keywords: ["git", "diff", "changes", "status", "变更", "改动", "差异"],
    icon: <GitDiffPanelIcon />,
    run: () => ctx.openGitDiffTab(),
  });

  cmds.push({
    id: "panel.llmAudit",
    title: t("Open LLM API audit"),
    group: "Panel",
    keywords: ["llm", "api", "audit", "request", "response", "调用", "审计", "请求", "响应"],
    icon: <LlmAuditPanelIcon />,
    run: () => ctx.openLlmAuditTab(),
  });

  // ── Modal (5) ──
  cmds.push({
    id: "modal.settings",
    title: t("Open settings"),
    group: "Modal",
    keywords: ["settings", "preferences", "config", "设置", "偏好", "配置"],
    icon: <GearIcon />,
    run: () => ctx.openSettings(),
  });
  cmds.push({
    id: "modal.models",
    title: t("Open models config"),
    group: "Modal",
    keywords: ["models", "config", "providers", "api", "模型", "配置", "服务商"],
    icon: <ChipIcon />,
    run: () => ctx.openModels(),
  });
  cmds.push({
    id: "modal.skills",
    title: t("Open skills"),
    group: "Modal",
    keywords: ["skills", "extensions", "技能", "扩展"],
    icon: <SparkleIcon />,
    when: (c) => c.hasCwd,
    run: () => ctx.openSkills(),
  });
  cmds.push({
    id: "modal.prompts",
    title: t("Open prompts"),
    group: "Modal",
    keywords: ["prompts", "templates", "slash", "提示词", "模板"],
    icon: <BookIcon />,
    when: (c) => c.hasCwd,
    run: () => ctx.openPrompts(),
  });
  cmds.push({
    id: "modal.scheduler",
    title: t("Open scheduled tasks"),
    group: "Modal",
    keywords: ["scheduler", "cron", "schedule", "timer", "tasks", "定时", "任务", "定时任务"],
    icon: <ClockIcon />,
    run: () => ctx.openScheduler(),
  });
  cmds.push({
    id: "modal.channels",
    title: t("Open channels"),
    group: "Modal",
    keywords: ["channels", "wechat", "weixin", "im", "platform", "微信", "频道", "消息"],
    icon: <GlobeIcon />,
    run: () => ctx.openChannels(),
  });

  cmds.push({
    id: "open-tool-market",
    title: t("Open Tool Market"),
    group: "Modal",
    keywords: ["tools", "market", "custom tools", "工具", "工具市场"],
    icon: <ToolMarketIcon />,
    run: () => ctx.openToolMarket(),
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
