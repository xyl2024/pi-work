"use client";

import type {
  MemoryFileEntry,
  MemoryFileListResponse,
  MemoryFileReadResponse,
} from "@/lib/shared/memory-main-view";

export class MemoryDisabledError extends Error {
  constructor() {
    super("Memory is not enabled");
    this.name = "MemoryDisabledError";
  }
}

export class MemoryConflictError extends Error {
  readonly content: string;
  readonly mtime: string;

  constructor(content: string, mtime: string) {
    super("Memory file changed on disk");
    this.name = "MemoryConflictError";
    this.content = content;
    this.mtime = mtime;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 404) throw new MemoryDisabledError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchMemoryFiles(signal?: AbortSignal): Promise<MemoryFileEntry[]> {
  const data = await request<MemoryFileListResponse>("/api/memory/files", { signal });
  return data.files;
}

export async function fetchMemoryFile(file: string): Promise<MemoryFileReadResponse> {
  return request<MemoryFileReadResponse>(`/api/memory/file?file=${encodeURIComponent(file)}`);
}

export async function saveMemoryFile(
  file: string,
  content: string,
  options: { openedMtime?: string | null; force?: boolean } = {},
): Promise<{ mtime: string }> {
  const res = await fetch("/api/memory/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file,
      content,
      ...(options.openedMtime != null ? { mtime: options.openedMtime } : {}),
      ...(options.force === true ? { force: true } : {}),
    }),
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { content?: string; mtime?: string };
    if (typeof body.content === "string" && typeof body.mtime === "string") {
      throw new MemoryConflictError(body.content, body.mtime);
    }
  }
  if (res.status === 404) throw new MemoryDisabledError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as { mtime: string };
}

export async function createMemoryFile(file: string): Promise<{ created: true }> {
  return request<{ created: true }>("/api/memory/file", {
    method: "POST",
    body: JSON.stringify({ file }),
  });
}

export async function deleteMemoryFile(file: string): Promise<{ deleted: true }> {
  return request<{ deleted: true }>(`/api/memory/file?file=${encodeURIComponent(file)}`, {
    method: "DELETE",
  });
}
