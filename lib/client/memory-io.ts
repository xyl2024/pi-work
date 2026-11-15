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

export async function saveMemoryFile(file: string, content: string): Promise<{ mtime: string }> {
  return request<{ mtime: string }>("/api/memory/file", {
    method: "PUT",
    body: JSON.stringify({ file, content }),
  });
}
