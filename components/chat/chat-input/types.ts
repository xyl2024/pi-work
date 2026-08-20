"use client";

/**
 * An image attached to the chat input. The base64 `data` has no prefix —
 * callers wrap it as `data:${mimeType};base64,${data}` when sending to
 * the agent. `previewUrl` is a blob URL created via `URL.createObjectURL`
 * for in-input thumbnail rendering; it must be revoked on unmount
 * (see useImageAttachments).
 */
export interface AttachedImage {
  data: string;       // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}