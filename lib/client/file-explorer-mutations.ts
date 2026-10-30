"use client";

import { encodeFilePathForApi } from "@/lib/shared/file-paths";

export type ExplorerCreateKind = "file" | "folder";

export interface CreateResult {
  ok: boolean;
  error?: string;
}

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

export async function moveEntry(sourcePath: string, destDir: string): Promise<CreateResult> {
  try {
    const encoded = encodeFilePathForApi(sourcePath);
    const res = await fetch(`/api/files/${encoded}?type=move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destDir }),
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

export async function duplicateEntry(sourcePath: string): Promise<CreateResult> {
  try {
    const encoded = encodeFilePathForApi(sourcePath);
    const res = await fetch(`/api/files/${encoded}?type=duplicate`, { method: "POST" });
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

export async function uploadFilesToDir(parentDir: string, files: File[]): Promise<UploadOutcome> {
  const form = new FormData();
  for (const f of files) {
    form.append("file", f, f.name);
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
