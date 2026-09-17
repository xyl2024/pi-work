"use client";

import { useCallback, useMemo } from "react";
import { MarkdownContent } from "@/components/renderers/MarkdownContent";
import { noteMediaUrl } from "@/lib/shared/notes";

interface NotePreviewProps {
  /** Relative path of the open note (.md), used to resolve relative image srcs. */
  noteRel: string;
  content: string;
}

/** Resolve a relative image reference in a note to a servable URL.
 *  `src` is relative to the note's directory. External/absolute/data URLs pass through. */
function resolveImageSrc(src: string, noteDir: string): string {
  if (/^(https?:|data:|blob:|\/)/i.test(src)) return src;
  if (!src.startsWith(".")) return src; // bare filename — treat as same-dir
  const target = src.startsWith("./") ? src.slice(2) : src.slice(1);
  const rel = noteDir ? `${noteDir}/${target}` : target;
  return noteMediaUrl(rel);
}

/** Read-only markdown preview for a note. Reuses pi-work's custom renderers
 *  (code / mermaid / svg / echarts) so preview matches the chat experience. */
export function NotePreview({ noteRel, content }: NotePreviewProps) {
  const noteDir = useMemo(
    () => noteRel.includes("/") ? noteRel.slice(0, noteRel.lastIndexOf("/")) : "",
    [noteRel],
  );

  const resolveImage = useCallback((src: string) => resolveImageSrc(src, noteDir), [noteDir]);

  return <MarkdownContent content={content} resolveImage={resolveImage} />;
}
