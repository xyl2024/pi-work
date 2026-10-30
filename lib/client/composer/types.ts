import type { ThinkingLevelOption } from "@/lib/shared/thinking-level-utils";

export interface ComposerTextNode {
  kind: "text";
  text: string;
}

export interface ComposerSkillNode {
  kind: "skill";
  source: "skill" | "action";
  name: string;
  command: string;
}

export interface ComposerFileNode {
  kind: "file";
  relativePath: string;
}

export interface ComposerImageNode {
  kind: "image";
  id: string;
  data: string;
  mimeType: string;
  previewUrl: string;
}

export type ComposerNode = ComposerTextNode | ComposerSkillNode | ComposerFileNode | ComposerImageNode;

export interface ComposerDoc {
  nodes: ComposerNode[];
}

export interface Cursor {
  node: number;
  offset: number;
}

export interface ComposerRange {
  start: number;
  end: number;
}

export interface ComposerSnapshot {
  doc: ComposerDoc;
  cursor: Cursor;
}

export interface ComposerHistory {
  sessionId: string | null;
  index: number | null;
  draft: string;
}

export interface ComposerState extends ComposerSnapshot {
  past: ComposerSnapshot[];
  future: ComposerSnapshot[];
  history: ComposerHistory;
}

export type ComposerEffect =
  | "none"
  | "edit"
  | "send"
  | "history-prev"
  | "history-next"
  | { type: "thinking"; level: ThinkingLevelOption };

export interface ComposerKeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  selection?: ComposerRange;
  sessionId?: string | null;
  history?: readonly string[];
  thinkingLevel?: ThinkingLevelOption;
  availableThinkingLevels?: readonly string[] | null;
}

export interface ComposerKeyResult {
  state: ComposerState;
  effect: ComposerEffect;
}

export interface SerializedComposer {
  text: string;
  images: ComposerImageNode[];
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export interface ComposerHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
  focus: () => void;
}
