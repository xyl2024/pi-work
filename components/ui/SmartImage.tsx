"use client";

import { useState } from "react";
import { ImageLoader, type ImageLoaderVariant } from "generative-loaders";
import { useI18n } from "@/hooks/useI18n";

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
  loaderVariant?: ImageLoaderVariant;
  loaderSize?: number | string;
  loaderLabel?: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState({ src, loaded: false, errored: false });
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
