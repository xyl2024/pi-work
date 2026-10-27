"use client";

/**
 * Browser side of the chat's "download request body" action.
 *
 * Fetches the captured provider request from
 * `/api/llm-audit/messages/[messageId]/request-body` and saves it as a file.
 * The response is fetched (not navigated to) so a message whose request was
 * never captured surfaces as a toast instead of a browser tab full of JSON.
 */

/** Why a download attempt did not produce a file. */
export type RequestBodyDownloadResult = "ok" | "not-recorded" | "failed";

/**
 * File name from a `Content-Disposition` header. Handles the plain
 * `filename=` form and the RFC 5987 `filename*=` form, and drops any path
 * segments a server might have put in the name.
 */
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
      // keep the undecoded value — it is still a usable file name
    }
  }
  // Only the last segment matters: a name must never be able to point outside
  // the user's download folder.
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
  // Revoke on the next task: revoking synchronously can cancel the download in
  // Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Download the request body recorded for one assistant message.
 *
 * `"not-recorded"` means the audit log has no request for this message (older
 * history, retention pruning, audit disabled) — distinct from `"failed"` so the
 * caller can say which happened.
 */
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
