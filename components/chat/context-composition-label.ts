import type { ContextBucketId, MessageCompositionLeafId } from "@/lib/shared/context-composition";

export const CONTEXT_BUCKET_LABELS: Record<ContextBucketId, string> = {
  "system-prompt": "System prompt",
  "system-tools": "System tool definitions",
  skills: "Skills",
  messages: "Messages",
};

export const CONTEXT_BUCKET_COLORS: Record<ContextBucketId, string> = {
  "system-prompt": "#a855f7",
  "system-tools": "#3b82f6",
  skills: "#f59e0b",
  messages: "#10b981",
};

export const MESSAGE_ROW_LABELS: Record<MessageCompositionLeafId, string> = {
  "user-text": "User-side text (incl. bash, custom)",
  "assistant-text": "Assistant text",
  thinking: "Thinking",
  "tool-call": "Tool call arguments",
  "tool-result": "Tool results",
  "compaction-summary": "Compaction summary",
  "branch-summary": "Branch summary",
};

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
  mono: boolean;
}

export function contextRowLabel(id: string, t: (key: string) => string): ContextRowLabel {
  if (id.startsWith("agents:")) return { text: id.slice("agents:".length), mono: true };
  if (id.startsWith("tool:")) return { text: id.slice("tool:".length), mono: true };
  return { text: t(ROW_LABELS[id] ?? id), mono: false };
}
