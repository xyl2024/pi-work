// Client-side API access for the Notes feature. Thin wrappers around the
// /api/notes routes — all fetch calls, no server logic.
import type { NoteNode } from "@/lib/shared/notes";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* ignore body */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchNotesTree(): Promise<NoteNode[]> {
  const data = await jsonOrThrow<{ tree?: NoteNode[] }>(
    await fetch("/api/notes", { method: "GET" }),
  );
  return data.tree ?? [];
}

export async function fetchNote(rel: string): Promise<{ content: string; mtime: string; size: number }> {
  return jsonOrThrow(await fetch(`/api/notes/${encodePath(rel)}`, { method: "GET" }));
}

export async function saveNote(rel: string, content: string): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/notes/${encodePath(rel)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

export async function createNote(dir: string, name: string): Promise<NoteNode> {
  const data = await jsonOrThrow<{ note?: NoteNode }>(
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "note", dir, name }),
    }),
  );
  if (!data.note) throw new Error("Create failed");
  return data.note;
}

export async function createFolder(dir: string, name: string): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "folder", dir, name }),
    }),
  );
}

export async function renameEntry(rel: string, newName: string): Promise<string> {
  const data = await jsonOrThrow<{ newRel?: string }>(
    await fetch(`/api/notes/${encodePath(rel)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "rename", newName }),
    }),
  );
  return data.newRel ?? rel;
}

export async function moveEntry(
  rel: string,
  destDir: string,
): Promise<{ newRel: string; samePath: boolean }> {
  const data = await jsonOrThrow<{ newRel?: string; samePath?: boolean }>(
    await fetch(`/api/notes/${encodePath(rel)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "move", destDir }),
    }),
  );
  return { newRel: data.newRel ?? rel, samePath: data.samePath === true };
}

export async function deleteEntry(rel: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/notes/${encodePath(rel)}`, { method: "DELETE" }));
}

/** Upload an image attachment for the given note. Returns { url, relPath }. */
export async function uploadNoteImage(
  rel: string,
  file: File,
): Promise<{ url: string; relPath: string }> {
  const form = new FormData();
  form.append("file", file);
  return jsonOrThrow(
    await fetch(`/api/notes/${encodePath(rel)}`, { method: "POST", body: form }),
  );
}

/** Encode a "/"-separated relative path into the route segments. */
function encodePath(rel: string): string {
  return rel
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}
