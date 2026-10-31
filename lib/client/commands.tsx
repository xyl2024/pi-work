"use client";

import type { ReactNode } from "react";
import type { ThemePreset } from "@/hooks/useTheme";
import { PRESETS } from "@/hooks/useTheme";
import type { Locale } from "@/hooks/useI18n";
import {
  flippedPermissionMode,
  isPermissionMode,
  type PermissionMode,
  type SessionPermissionMode,
} from "@/lib/shared/permission-mode";
import { ICONS } from "@/components/ui/icons";
import { PANEL_TAB_SPECS, type PanelViewKind } from "@/lib/shared/panelTabs";
import {
  Languages,
  LetterText,
  PanelRight,
  FolderOpen,
} from "lucide-react";

export interface AgentControls {
  abortStreaming: () => void | Promise<void>;
  isStreaming: boolean;
  permissionMode?: SessionPermissionMode;
  setPermissionMode?: (mode: PermissionMode) => void | Promise<void>;
}

const PlusIcon = ICONS.plus;
const StopIcon = ICONS.stop;
const SunIcon = ICONS.sun;
const MoonIcon = ICONS.moon;
const SidebarIcon = ICONS.sidebar;
const GearIcon = ICONS.gear;
const ShieldIcon = ICONS.shield;

const RightPanelIcon = () => <PanelRight size={16} />;
const CwdPickerIcon = () => <FolderOpen size={16} />;
const EnglishLanguageIcon = () => <LetterText size={16} />;
const ChineseLanguageIcon = () => <Languages size={16} />;

const ThemeIcon = ({ preset }: { preset: ThemePreset }) => {
  return preset === "dark" ? <MoonIcon /> : <SunIcon />;
};

export const COMMAND_GROUPS = [
  "Session",
  "Theme",
  "View",
  "Panel",
  "Modal",
  "Language",
] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  keywords?: string[];
  icon: ReactNode;
  shortcut?: string;
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

export interface CommandContext {
  setTheme: (preset: ThemePreset) => void;
  setLocale: (locale: Locale) => void;

  newSession: () => void;

  openSettings: () => void;
  openCwdPicker: () => void;

  toggleSidebar: () => void;
  toggleRightPanel: () => void;

  togglePanel: (kind: PanelViewKind) => void;

  agentControls: AgentControls | null;

  hasSession: boolean;
}

function buildPanelCommands(
  ctx: CommandContext,
  t: (key: string) => string,
  icons: Partial<Record<PanelViewKind, ReactNode>>,
): Command[] {
  return PANEL_TAB_SPECS.flatMap((spec): Command[] =>
    (spec.commands ?? []).map((entry) => ({
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

  const permissionMode = ctx.agentControls?.permissionMode;
  cmds.push({
    id: "session.permission_mode",
    title: permissionMode === "full_access"
      ? t("Switch to confirm dangerous commands")
      : t("Switch to allow full access"),
    group: "Session",
    keywords: [
      "permission", "permissions", "dangerous", "command", "confirm", "full", "access", "shield", "yolo",
      "权限", "完全访问", "确认", "危险命令",
    ],
    icon: <ShieldIcon />,
    when: (c) =>
      !!c.agentControls?.setPermissionMode
      && isPermissionMode(c.agentControls.permissionMode),
    run: () => {
      const mode = ctx.agentControls?.permissionMode;
      if (!isPermissionMode(mode)) return;
      return ctx.agentControls?.setPermissionMode?.(flippedPermissionMode(mode));
    },
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
  cmds.push(...buildPanelCommands(ctx, t, panelIcons));
  cmds.push({
    id: "modal.settings",
    title: t("Open settings"),
    group: "Modal",
    keywords: ["settings", "preferences", "config", "设置", "偏好", "配置"],
    icon: <GearIcon />,
    run: () => ctx.openSettings(),
  });
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

  return cmds.filter((c) => !c.when || c.when(ctx));
}

export function scoreCommand(cmd: Command, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();

  if (cmd.title.toLowerCase() === q) return 1000;

  if (cmd.title.toLowerCase().startsWith(q)) return 500;

  const titleLower = cmd.title.toLowerCase();
  if (titleLower.includes(q)) return 200 + (titleLower.indexOf(q) === 0 ? 50 : 0);

  for (const k of cmd.keywords ?? []) {
    if (k.toLowerCase() === q) return 400;
  }

  const haystack = [cmd.title.toLowerCase(), ...(cmd.keywords ?? []).map((k) => k.toLowerCase())];
  let best = -1;
  for (const h of haystack) {
    const s = fuzzyScore(h, q);
    if (s > best) best = s;
  }
  return best;
}

function fuzzyScore(haystack: string, needle: string): number {
  let hi = 0;
  let ni = 0;
  let score = 0;
  let prevMatch = -1;
  while (hi < haystack.length && ni < needle.length) {
    if (haystack[hi] === needle[ni]) {
      score += 10;
      if (prevMatch === hi - 1) score += 5;
      if (hi < 3) score += 3;
      prevMatch = hi;
      ni++;
    }
    hi++;
  }
  if (ni < needle.length) return -1;
  score -= Math.floor(haystack.length / 10);
  return score;
}
