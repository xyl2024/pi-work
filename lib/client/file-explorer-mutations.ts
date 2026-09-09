"use client";

/**
 * Client helpers for the sidebar file explorer's mutating actions
 * (create file/folder, upload file/folder). All of them talk to the
 * existing `/api/files` routes:
 *
 *   POST /api/files/<dir>?type=create   body {name}            → empty file
 *   POST /api/files/<dir>?type=mkdir    body {name}            → directory
 *   POST /api/files/<dir>?type=upload   multipart form-data    → files
 *
 * Server side lives in lib/server/files/mutations.ts. Keep the error
 * strings here opaque (they come straight from the server's `error`
 * field) so i18n for user-facing text happens at the component layer.
 */

import { encodeFilePathForApi } from "@/lib/shared/file-paths";

export type ExplorerCreateKind = "file" | "folder";

export interface CreateResult {
  ok: boolean;
  /** Raw server error message when ok === false. */
  error?: string;
}

/** Create an empty file or a directory inside `parentDir`. */
export async function createEntry(
  parentDir: string,
  kind: ExplorerCreateKind,
  name: string,
): Promise<CreateResult> {
  try {
    const encoded = encodeFilePathForApi(parentDir);
    const type = kind === "folder" ? "mkdir" : "create";
    const res = await fetch(`/api/files/${encoded}?type=${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "" }));
      return { ok: false, error: error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export interface UploadOutcome {
  uploaded: number;
  skipped: number;
  failed: { path: string; error: string }[];
}

/** Upload files (or a picked directory tree) into `parentDir`. The
 *  server never overwrites existing entries — they come back counted in
 *  `skipped`. Throws with the server error message when the whole
 *  request fails (access denied, too many files, ...). */
export async function uploadFilesToDir(parentDir: string, files: File[]): Promise<UploadOutcome> {
  const form = new FormData();
  for (const f of files) {
    form.append("file", f, f.name);
    // webkitRelativePath preserves the picked folder structure
    // ("folder/sub/file.txt"); plain file picks have it empty.
    form.append("path", f.webkitRelativePath || f.name);
  }
  const encoded = encodeFilePathForApi(parentDir);
  const res = await fetch(`/api/files/${encoded}?type=upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "" }));
    throw new Error(error || `HTTP ${res.status}`);
  }
  return (await res.json()) as UploadOutcome;
}

/**
 * Open a native file picker and resolve with the selected files. With
 * `directory` the picker selects a folder (webkitdirectory) and each
 * File carries its `webkitRelativePath`. Resolves [] when the picker is
 * cancelled. The hidden <input> is created on the fly so callers don't
 * need per-component refs.
 */
export function pickFiles(opts?: { directory?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (opts?.directory) {
      input.setAttribute("webkitdirectory", "");
    }
    input.style.display = "none";
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}
