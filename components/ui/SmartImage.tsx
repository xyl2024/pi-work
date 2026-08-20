"use client";

import { useState } from "react";
import { ImageLoader, type ImageLoaderVariant } from "generative-loaders";
import { useI18n } from "@/hooks/useI18n";

/**
 * <img> with an ImageLoader placeholder while the resource is in flight.
 *
 * The image element is always mounted (opacity 0 while loading) so the
 * browser actually fetches it; the loader sits beside it in an inline-flex
 * span that takes the loader's footprint until the image reports its real
 * size. Pass `loaderSize` to match the target layout (avatar thumbnails →
 * small, full-size viewers → large).
 *
 * `onLoad` / `onError` pass through unchanged — callers keep their own
 * natural-size / fallback logic. On error the placeholder stops animating
 * and the raw <img> is shown (callers usually swap in their own error UI).
 */
export function SmartImage({
  src,
  alt = "",
  loaderVariant = "resolution",
  loaderSize = 96,
  loaderLabel,
  onLoad,
  onError,
  style,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  /** ImageLoader variant shown while the image loads. */
  loaderVariant?: ImageLoaderVariant;
  /** ImageLoader footprint while loading (px or CSS length). */
  loaderSize?: number | string;
  /** Accessible label for the loading state. */
  loaderLabel?: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState({ src, loaded: false, errored: false });
  // Derive-state reset when src changes (avatar cache-bust `k=`, file
  // switching) — render-time compare avoids a one-frame stale loader.
  if (state.src !== src) {
    setState({ src, loaded: false, errored: false });
  }
  const loading = !state.loaded && !state.errored;

  return (
    <span
      className="smart-image"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
        ...(loading ? { width: loaderSize, height: loaderSize } : {}),
      }}
    >
      {loading && (
        <ImageLoader
          variant={loaderVariant}
          size={loaderSize}
          label={loaderLabel ?? t("Loading image")}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={(e) => {
          setState((s) => (s.src === src ? { ...s, loaded: true } : s));
          onLoad?.(e);
        }}
        onError={(e) => {
          setState((s) => (s.src === src ? { ...s, errored: true } : s));
          onError?.(e);
        }}
        style={{ ...style, opacity: loading ? 0 : 1 }}
        {...rest}
      />
    </span>
  );
}
