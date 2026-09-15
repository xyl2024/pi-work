// Labels for the context-composition surfaces (the ring tooltip and the
// popover). Kept out of the components because both render the same vocabulary,
// and out of `lib/shared/context-composition` because i18n keys are a UI
// concern (the pure module must not know about `t`).
//
// The bucket/message maps are `Record`s rather than lookup-with-fallback, so
// adding a bucket or a message leaf in the shared module is a compile error here
// instead of an untranslated row.

import type { ContextBucketId, MessageCompositionLeafId } from "@/lib/shared/context-composition";

/** i18n keys for the four buckets. `messages` uses the disambiguated key
 *  because the plain `Messages` key is the kanban count label (`消息数`), which
 *  would win the dictionary merge. */
export const CONTEXT_BUCKET_LABELS: Record<ContextBucketId, string> = {
  "system-prompt": "System prompt",
  "system-tools": "System tool definitions",
  skills: "Skills",
  messages: "Messages (context)",
};

/** Palette for the stacked bar and the row swatches. Same six-color family the
 *  Context panel uses for AGENTS.md segments, picked so the four buckets stay
 *  distinguishable at the 8px bar height. */
export const CONTEXT_BUCKET_COLORS: Record<ContextBucketId, string> = {
  "system-prompt": "#a855f7", // purple
  "system-tools": "#3b82f6", // blue
  skills: "#f59e0b", // amber
  messages: "#10b981", // emerald
};

/** i18n keys for the seven message rows. `user-text` says "user-side" on
 *  purpose: pi folds bash executions and custom messages into it, so it is not
 *  "what the user typed" and the label must not imply that. */
export const MESSAGE_ROW_LABELS: Record<MessageCompositionLeafId, string> = {
  "user-text": "User-side text (incl. bash, custom)",
  "assistant-text": "Assistant text",
  thinking: "Thinking",
  "tool-call": "Tool call arguments",
  "tool-result": "Tool results",
  "compaction-summary": "Compaction summary",
  "branch-summary": "Branch summary",
};

/** Every fixed row id → its i18n key. `agents:*` / `tool:*` are not in here:
 *  they are named by their own path / tool name instead. */
const ROW_LABELS: Record<string, string> = {
  base: "Pi base prompt",
  "available-tools": "Available tools",
  guidelines: "Guidelines",
  "pi-docs": "Pi documentation",
  append: "Append",
  cwd: "Current working directory",
  skills: "Skills",
  ...MESSAGE_ROW_LABELS,
};

export interface ContextRowLabel {
  text: string;
  /** Render the label in the monospace stack (file paths, tool names). */
  mono: boolean;
}

/** Resolve a composition row id to its label. Project context files and tool
 *  schemas are named by their own path / tool name — those are data, not
 *  copy, so they are not routed through the dictionary. */
export function contextRowLabel(id: string, t: (key: string) => string): ContextRowLabel {
  if (id.startsWith("agents:")) return { text: id.slice("agents:".length), mono: true };
  if (id.startsWith("tool:")) return { text: id.slice("tool:".length), mono: true };
  return { text: t(ROW_LABELS[id] ?? id), mono: false };
}
