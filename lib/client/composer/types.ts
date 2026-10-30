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

export interface ComposerState extends ComposerSnapshot {
  past: ComposerSnapshot[];
  future: ComposerSnapshot[];
}

export type ComposerEffect =
  | "none"
  | "edit"
  | "send"
  | "thinking-next"
  | "history-prev"
  | "history-next";

export interface ComposerKeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  selection?: ComposerRange;
}

export interface ComposerKeyResult {
  state: ComposerState;
  effect: ComposerEffect;
}

export interface SerializedComposer {
  text: string;
  images: ComposerImageNode[];
}

export interface ComposerHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
  focus: () => void;
}
