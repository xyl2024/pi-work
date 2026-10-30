import { describe, expect, it } from "vitest";
import {
  createImageNode,
  isImageFile,
  toAttachedImage,
} from "@/lib/client/composer/images";

describe("parseImageDataUrl", () => {
  it("splits a base64 data URL into mime type and payload", () => {
    const node = createImageNode({
      id: "one",
      dataUrl: "data:image/png;base64,QUJD",
      previewUrl: "blob:one",
    });
    expect(node).toEqual({
      kind: "image",
      id: "one",
      data: "QUJD",
      mimeType: "image/png",
      previewUrl: "blob:one",
    });
  });

  it("rejects non-base64 and non-image data URLs", () => {
    expect(createImageNode({ id: "a", dataUrl: "data:image/png,plain", previewUrl: "blob:a" })).toBeNull();
    expect(createImageNode({ id: "b", dataUrl: "data:text/plain;base64,QUJD", previewUrl: "blob:b" })).toBeNull();
    expect(createImageNode({ id: "c", dataUrl: "not-a-data-url", previewUrl: "blob:c" })).toBeNull();
  });

  it("keeps multi-line base64 payloads intact", () => {
    const node = createImageNode({
      id: "one",
      dataUrl: "data:image/png;base64,QU\nJD",
      previewUrl: "blob:one",
    });
    expect(node?.data).toBe("QU\nJD");
  });
});

describe("image chip helpers", () => {
  it("maps a node to the existing AttachedImage shape", () => {
    expect(toAttachedImage({
      kind: "image",
      id: "one",
      data: "QUJD",
      mimeType: "image/png",
      previewUrl: "blob:one",
    })).toEqual({ data: "QUJD", mimeType: "image/png", previewUrl: "blob:one" });
  });

  it("accepts only image files", () => {
    expect(isImageFile({ type: "image/webp" } as File)).toBe(true);
    expect(isImageFile({ type: "application/pdf" } as File)).toBe(false);
  });
});
