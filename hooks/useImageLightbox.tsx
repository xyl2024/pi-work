"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ImageLightbox, type ImageItem } from "@/components/renderers/ImageLightbox";

/**
 * State + JSX for an inline `<ImageLightbox>` triggered by an `<img>`
 * click. Owns the `index` state, the `openAt(src)` matcher, the `close`
 * handler, and the rendered `<ImageLightbox>` node.
 *
 * Usage:
 *   const gallery = imageBlocks.map(...);                    // ImageItem[]
 *   const lb = useImageLightbox(gallery);
 *   return (
 *     <>
 *       <img onClick={() => lb.openAt(img.src)} />
 *       {body}
 *       {lb.lightbox}
 *     </>
 *   );
 *
 * `openAt` resolves `src` against the gallery each call so callers don't
 * need to plumb the index through their click handlers. `lightbox` is
 * `null` while closed; mount it unconditionally at the end of the parent.
 */
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
