import type { AttachedImage, ComposerImageNode } from "./types";

export interface ImageSource {
  id: string;
  name?: string;
  dataUrl: string;
  previewUrl: string;
}

let imageSequence = 0;

export function nextImageId(): string {
  imageSequence += 1;
  return `image-${imageSequence}`;
}

export function parseImageDataUrl(dataUrl: string): { data: string; mimeType: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1].trim();
  if (!mimeType.startsWith("image/")) return null;
  return { data: match[2], mimeType };
}

export function createImageNode(source: ImageSource): ComposerImageNode | null {
  const parsed = parseImageDataUrl(source.dataUrl);
  if (!parsed) return null;
  return {
    kind: "image",
    id: source.id,
    ...(source.name ? { name: source.name } : {}),
    data: parsed.data,
    mimeType: parsed.mimeType,
    previewUrl: source.previewUrl,
  };
}

export function toAttachedImage(node: ComposerImageNode): AttachedImage {
  return { data: node.data, mimeType: node.mimeType, previewUrl: node.previewUrl };
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
