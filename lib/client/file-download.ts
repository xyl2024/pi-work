import { encodeFilePathForApi } from "@/lib/shared/file-paths";

export function downloadFile(filePath: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = `/api/files/${encodeFilePathForApi(filePath)}?type=download`;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
