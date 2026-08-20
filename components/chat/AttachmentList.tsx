"use client";

import { SmartImage } from "../ui/SmartImage";
import type { AttachedImage } from "./ChatInput";

/**
 * Horizontal strip of image thumbnails above the chat textarea. Each tile
 * has a tiny close button that revokes the object URL via `onRemove`.
 * Renders nothing when the list is empty so the caller can drop it in
 * unconditionally.
 */
export function AttachmentList({ images, onRemove }: {
  images: AttachedImage[];
  onRemove: (index: number) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
      {images.map((img, i) => (
        <div key={i} style={{ position: "relative", flexShrink: 0 }}>
          <SmartImage
            src={img.previewUrl}
            alt=""
            loaderSize={24}
            style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }}
          />
          <button
            onClick={() => onRemove(i)}
            style={{
              position: "absolute", top: -4, right: -4,
              width: 16, height: 16, borderRadius: "50%",
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", padding: 0, color: "var(--text-muted)",
            }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
