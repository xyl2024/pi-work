"use client";

import type { ThinkingLevel } from "../ThinkingPicker";
import type { SlashResource } from "@/lib/shared/slash-commands";

// Border color reflects the active reasoning intensity: gray = off, then a
// cool-to-warm gradient up to red for xhigh. Uses the same level union
// as ThinkingPicker.THINKING_LEVELS so the keys stay in sync.
export const THINKING_BORDER_COLOR: Record<ThinkingLevel, string> = {
  off: "rgba(148,163,184,0.55)",   // slate-400
  minimal: "rgba(56,189,248,0.55)", // sky-400
  low: "rgba(59,130,246,0.55)",    // blue-500
  medium: "rgba(139,92,246,0.55)",  // violet-500
  high: "rgba(249,115,22,0.55)",    // orange-500
  xhigh: "rgba(239,68,68,0.55)",    // red-500
  max: "rgba(185,28,28,0.65)",      // red-700
};

/** Slash-command menu pagination size. */
export const SLASH_PAGE_SIZE = 5;

/** Built-in `/new` slash command. Starts a fresh session in the active cwd
 *  (selected session's cwd, or the in-flight new-session cwd). */
export const BUILTIN_NEW_SESSION: SlashResource = {
  source: "action",
  name: "New session",
  command: "new",
  description: "新建会话",
  path: "",
  content: "",
};

/** Built-in `/compact` slash command — triggers the same path as the
 *  toolbar's `Compact` button (handleCompact in ChatWindow → useAgentSession).
 *  `source: "action"` skips the prompt-template expansion step in
 *  selectSlashResource and just invokes `onSlashAction?.("compact")`. */
export const BUILTIN_COMPACT: SlashResource = {
  source: "action",
  name: "Compact",
  command: "compact",
  description: "压缩当前会话上下文",
  path: "",
  content: "",
};

/** Built-in `/btw` slash command — opens the right BTW panel and focuses its
 *  input so the user can immediately ask a question grounded in the active
 *  session's context (same `source: "action"` path as `/new` and `/compact`;
 *  handled by AppShell via `onSlashAction?.("btw")` → opens the tab + bumps
 *  the BtwPanel focus request). */
export const BUILTIN_BTW: SlashResource = {
  source: "action",
  name: "BTW",
  command: "btw",
  description: "打开 BTW 面板并向当前会话提问",
  path: "",
  content: "",
};

export const BUILTIN_SLASH_ACTIONS: SlashResource[] = [BUILTIN_NEW_SESSION, BUILTIN_COMPACT, BUILTIN_BTW];