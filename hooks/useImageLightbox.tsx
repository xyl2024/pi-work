"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ImageLightbox, type ImageItem } from "@/components/renderers/ImageLightbox";

export function useImageLightbox(images: ImageItem[]): {
  index: number | null;
  openAt: (src: string) => void;
  close: () => void;
  lightbox: ReactNode;
} {
  const [index, setIndex] = useState<number | null>(null);

  const openAt = useCallback(
    (src: string) => {
      const idx = images.findIndex((item) => item.src === src);
      if (idx >= 0) setIndex(idx);
    },
    [images],
  );

  const close = useCallback(() => setIndex(null), []);

  const lightbox = useMemo(() => {
    if (index === null) return null;
    if (images.length === 0) return null;
    return (
      <ImageLightbox
        images={images}
        index={index}
        onClose={close}
        onIndexChange={setIndex}
      />
    );
  }, [index, images, close]);

  return { index, openAt, close, lightbox };
}
