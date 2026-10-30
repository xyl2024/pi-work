"use client";

import type { LanguageCode } from "@/lib/shared/translate";

export interface TranslateBubbleAnchor {
  top: number;
  centerX: number;
  width: number;
}

export interface TranslateBubbleSnapshot {
  open: boolean;
  direction: LanguageCode;
  sourceText: string;
  anchorRect: TranslateBubbleAnchor | null;
  requestSeq: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: TranslateBubbleSnapshot = {
  open: false,
  direction: "zh",
  sourceText: "",
  anchorRect: null,
  requestSeq: 0,
};

function notify(): void {
  for (const l of listeners) l();
}

export function openTranslateBubble(
  direction: LanguageCode,
  sourceText: string,
  anchorRect: TranslateBubbleAnchor,
): void {
  if (!sourceText) return;
  snapshot = {
    open: true,
    direction,
    sourceText,
    anchorRect,
    requestSeq: snapshot.requestSeq + 1,
  };
  notify();
}

export function closeTranslateBubble(): void {
  if (!snapshot.open) return;
  snapshot = {
    open: false,
    direction: snapshot.direction,
    sourceText: snapshot.sourceText,
    anchorRect: snapshot.anchorRect,
    requestSeq: snapshot.requestSeq,
  };
  notify();
}

export function getTranslateBubbleSnapshot(): TranslateBubbleSnapshot {
  return snapshot;
}

export function subscribeTranslateBubble(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
