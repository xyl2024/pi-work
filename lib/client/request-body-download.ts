"use client";

export type RequestBodyDownloadResult = "ok" | "not-recorded" | "failed";

export function parseAttachmentFileName(header: string | null): string | null {
  if (!header) return null;
  const encoded = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  const raw = encoded?.[1] ?? plain?.[1];
  if (!raw) return null;
  let name = raw.trim();
  if (encoded) {
    try {
      name = decodeURIComponent(name);
    } catch {
    }
  }
  const segment = name.split(/[\\/]/).pop()?.trim();
  return segment || null;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadMessageRequestBody(params: {
  sessionId: string;
  messageId: string;
}): Promise<RequestBodyDownloadResult> {
  const { sessionId, messageId } = params;
  try {
    const response = await fetch(
      `/api/llm-audit/messages/${encodeURIComponent(messageId)}/request-body?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (response.status === 404) return "not-recorded";
    if (!response.ok) return "failed";
    const fileName =
      parseAttachmentFileName(response.headers.get("content-disposition")) ??
      `request-body-${messageId}.json`;
    saveBlob(await response.blob(), fileName);
    return "ok";
  } catch (error) {
    console.warn("request body download failed:", error);
    return "failed";
  }
}
