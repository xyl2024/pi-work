"use client";

import type { ThinkingLevel } from "../ThinkingPicker";
import type { SlashResource } from "@/lib/shared/slash-commands";

export const THINKING_BORDER_COLOR: Record<ThinkingLevel, string> = {
  off: "rgba(148,163,184,0.55)",
  minimal: "rgba(56,189,248,0.55)",
  low: "rgba(59,130,246,0.55)",
  medium: "rgba(139,92,246,0.55)",
  high: "rgba(249,115,22,0.55)",
  xhigh: "rgba(239,68,68,0.55)",
  max: "rgba(185,28,28,0.65)",
};

export const SLASH_PAGE_SIZE = 5;

export const BUILTIN_NEW_SESSION: SlashResource = {
  source: "action",
  name: "New session",
  command: "new",
  description: "新建会话",
  path: "",
};

export const BUILTIN_COMPACT: SlashResource = {
  source: "action",
  name: "Compact",
  command: "compact",
  description: "压缩当前会话上下文",
  path: "",
};

export const BUILTIN_MODEL: SlashResource = {
  source: "action",
  name: "Model",
  command: "model",
  description: "切换模型 / Switch model",
  path: "",
};

export const BUILTIN_SLASH_ACTIONS: SlashResource[] = [BUILTIN_NEW_SESSION, BUILTIN_COMPACT, BUILTIN_MODEL];