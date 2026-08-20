"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachedImage } from "../types";

export interface UseImageAttachmentsResult {
  attachedImages: AttachedImage[];
  /** Ref to attach to the hidden `<input type="file" accept="image/*">`. */
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /** Process a batch of File objects: filter to images, read as base64 +
   *  create object URLs for preview. */
  processImageFiles: (files: File[]) => Promise<void>;
  /** Remove one image and revoke its object URL. */
  removeImage: (index: number) => void;
  /** Revoke every URL and clear the list. */
  clearImages: () => void;
  /** Handle a paste event that may contain image files; if it does, calls
   *  `processImageFiles` after `preventDefault`. */
  handlePaste: (e: React.ClipboardEvent) => void;
}

/**
 * Encapsulates the image attachment state, file input ref, and the URL
 * revoke lifecycle. The cleanup effect runs on unmount and revokes every
 * preview URL still referenced via `attachedImagesRef.current` — a ref is
 * required because changing the attachment list must not revoke URLs that
 * are still in use.
 */
export function useImageAttachments(): UseImageAttachmentsResult {
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const attachedImagesRef = useRef<AttachedImage[]>([]);
  attachedImagesRef.current = attachedImages;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs when this tab/controller is finally closed. A ref is
  // required so changing the attachment list does not revoke URLs still in use.
  useEffect(
    () => () => {
      for (const image of attachedImagesRef.current) URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  const processImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<AttachedImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // result is "data:<mime>;base64,<data>"
              const base64 = result.split(",")[1];
              resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
      ),
    );
    setAttachedImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));
      if (!imageItems.length) return;
      e.preventDefault();
      const files = imageItems
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      void processImageFiles(files);
    },
    [processImageFiles],
  );

  return {
    attachedImages,
    fileInputRef,
    processImageFiles,
    removeImage,
    clearImages,
    handlePaste,
  };
}