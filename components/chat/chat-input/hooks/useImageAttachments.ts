"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachedImage } from "../types";

export interface UseImageAttachmentsResult {
  attachedImages: AttachedImage[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  processImageFiles: (files: File[]) => Promise<void>;
  removeImage: (index: number) => void;
  clearImages: () => void;
  handlePaste: (e: React.ClipboardEvent) => void;
}

export function useImageAttachments(): UseImageAttachmentsResult {
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const attachedImagesRef = useRef<AttachedImage[]>([]);
  attachedImagesRef.current = attachedImages;
  const fileInputRef = useRef<HTMLInputElement>(null);

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