import type { FileViewerKind } from "@/lib/shared/file-viewer-limits";

export const FILE_VIEWER_UI: Array<{ kind: FileViewerKind; labelKey: string }> = [
  { kind: "text",  labelKey: "Max size for text / code files" },
  { kind: "image", labelKey: "Max size for image files" },
  { kind: "pdf",   labelKey: "Max size for PDF files" },
];