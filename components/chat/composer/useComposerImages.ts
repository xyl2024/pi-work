"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useImageLightbox } from "@/hooks/useImageLightbox";
import { createImageNode, isImageFile, nextImageId } from "@/lib/client/composer/images";
import { insertNodes, removeImage } from "@/lib/client/composer/model";
import type {
  ComposerDoc,
  ComposerImageNode,
  ComposerState,
  Cursor,
} from "@/lib/client/composer/types";

export interface ComposerImageLabels {
  image: (id: string, name?: string) => string;
  removeImage: (id: string, name?: string) => string;
}

interface UseComposerImagesOptions {
  state: ComposerState;
  getState: () => ComposerState;
  updateState: (next: ComposerState) => void;
  focusEditor: (doc: ComposerDoc, cursor: Cursor) => void;
  composingRef: React.RefObject<boolean>;
  labels: ComposerImageLabels;
}

export function useComposerImages({
  state,
  getState,
  updateState,
  focusEditor,
  composingRef,
  labels,
}: UseComposerImagesOptions) {
  const imageUrlsRef = useRef<Set<string>>(new Set());
  const pendingImagesRef = useRef<ComposerImageNode[]>([]);

  const images = useMemo(
    () => state.doc.nodes.filter((node): node is ComposerImageNode => node.kind === "image"),
    [state.doc],
  );

  const imageItems = useMemo(
    () => images.map((node) => ({ alt: labels.image(node.id, node.name), src: node.previewUrl })),
    [images, labels],
  );

  const { openAt, lightbox } = useImageLightbox(imageItems);

  useEffect(() => {
    const live = new Set<string>();
    const collect = (doc: ComposerDoc) => {
      for (const node of doc.nodes) {
        if (node.kind === "image") live.add(node.previewUrl);
      }
    };
    for (const snapshot of state.past) collect(snapshot.doc);
    collect(state.doc);
    for (const snapshot of state.future) collect(snapshot.doc);
    for (const node of pendingImagesRef.current) live.add(node.previewUrl);
    for (const url of Array.from(imageUrlsRef.current)) {
      if (live.has(url)) continue;
      URL.revokeObjectURL(url);
      imageUrlsRef.current.delete(url);
    }
  }, [state]);

  useEffect(() => {
    const urls = imageUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const addImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) return;
    const nodes = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<ComposerImageNode | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const previewUrl = URL.createObjectURL(file);
              const node = createImageNode({
                id: nextImageId(),
                name: file.name || undefined,
                dataUrl: String(reader.result ?? ""),
                previewUrl,
              });
              if (!node) URL.revokeObjectURL(previewUrl);
              resolve(node);
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );
    const valid = nodes.filter((node): node is ComposerImageNode => node !== null);
    if (valid.length === 0) return;
    for (const node of valid) imageUrlsRef.current.add(node.previewUrl);
    if (composingRef.current) {
      pendingImagesRef.current.push(...valid);
      return;
    }
    const next = insertNodes(getState(), valid);
    updateState(next);
    focusEditor(next.doc, next.cursor);
  }, [composingRef, focusEditor, getState, updateState]);

  const flushPendingImages = useCallback(() => {
    const pending = pendingImagesRef.current.splice(0);
    if (pending.length === 0) return;
    const next = insertNodes(getState(), pending);
    updateState(next);
    focusEditor(next.doc, next.cursor);
  }, [focusEditor, getState, updateState]);

  const removeImageById = useCallback((id: string) => {
    updateState(removeImage(getState(), id));
  }, [getState, updateState]);

  return {
    images,
    imageItems,
    lightbox,
    openAt,
    addImages,
    flushPendingImages,
    removeImageById,
  };
}
