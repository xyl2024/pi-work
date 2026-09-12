// Server-side note file operations.
//
// Notes are plain Markdown files under <dataRoot>/user-notes/. A note's
// image attachments live in a sibling `<stem>.assets/` folder so the note
// (file + attachments) can be moved / renamed / deleted as one unit — that
// is what keeps `./<stem>.assets/...` references valid across moves.
//
// All entry points take a note-relative path (segments under the root).
// Paths are normalized and ".."-traversal is stripped; every absolute path
// is re-checked against the root before use (defence in depth).
import fs from "fs";
import path from "path";
import { validateFileName } from "@/lib/shared/file-name";
import {
  isNoteAssetsDir,
  noteAssetsDir,
  normalizeNotePath,
  type NoteNode,
} from "@/lib/shared/notes";
import { dataPath } from "../data-dir";

/** Server-side mirror of the error shape used by file-access handlers. */
export class NotesError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function error(message: string, status: number): never {
  throw new NotesError(message, status);
}

export function notesRoot(): string {
  return dataPath("user-notes");
}

function absPath(rel: string): string {
  const parts = normalizeNotePath(rel).split("/").filter(Boolean);
  if (parts.length === 0) return notesRoot(); // empty rel → the root itself
  return path.join(notesRoot(), ...parts);
}

function assertInsideRoot(abs: string): void {
  const root = path.resolve(notesRoot());
  const resolved = path.resolve(abs);
  const rel = path.relative(root, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  error("Access denied", 403);
}

function uniqueChildPath(parentDir: string, name: string): string {
  if (!fs.existsSync(path.join(parentDir, name))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let i = 2;
  for (;;) {
    const candidate = `${stem} ${i}${ext}`;
    if (!fs.existsSync(path.join(parentDir, candidate))) return candidate;
    i += 1;
  }
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".") || isNoteAssetsDir(name);
}

/** Recursively build a note tree (folders first, then files; each lexicographic,
 *  dotfiles and attachment bundles hidden). */
function buildNode(abs: string, rel: string): NoteNode {
  const stat = fs.statSync(abs);
  const type: NoteNode["type"] = stat.isDirectory() ? "folder" : "file";
  const base: NoteNode = {
    name: path.basename(abs),
    type,
    path: rel,
  };
  if (type === "file") {
    base.size = stat.size;
    base.mtime = stat.mtime.toISOString();
    return base;
  }
  const children: NoteNode[] = [];
  for (const name of fs.readdirSync(abs)) {
    if (isHiddenName(name)) continue;
    const childAbs = path.join(abs, name);
    if (!fs.statSync(childAbs).isDirectory() && !name.toLowerCase().endsWith(".md")) continue;
    children.push(buildNode(childAbs, rel ? `${rel}/${name}` : name));
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  base.children = children;
  return base;
}

/** List the full note tree (root-level nodes, recursively nested). */
export function listTree(): NoteNode[] {
  const root = notesRoot();
  fs.mkdirSync(root, { recursive: true });
  const rootNode = buildNode(root, "");
  return rootNode.children ?? [];
}

/** Create a note `<dir>/<title>.md`. Returns the created node. */
export function createNote(relDir: string, title: string): NoteNode {
  const v = validateFileName(title.replace(/\.md$/i, ""));
  if (!v.ok) error(v.message, 400);
  const dir = relDir ? absPath(relDir) : notesRoot();
  assertInsideRoot(dir);
  fs.mkdirSync(dir, { recursive: true });

  let name = `${v.name}.md`;
  name = uniqueChildPath(dir, name);
  const abs = path.join(dir, name);
  assertInsideRoot(abs);
  fs.writeFileSync(abs, "", "utf8");

  const rel = relDir ? `${relDir}/${name}` : name;
  const stat = fs.statSync(abs);
  return { name, type: "file", path: rel, size: 0, mtime: stat.mtime.toISOString() };
}

/** Create an empty folder under relDir. */
export function createFolder(relDir: string, name: string): void {
  const v = validateFileName(name);
  if (!v.ok) error(v.message, 400);
  if (isNoteAssetsDir(v.name) || v.name.startsWith(".")) error("Invalid name", 400);
  const dir = relDir ? absPath(relDir) : notesRoot();
  assertInsideRoot(dir);
  fs.mkdirSync(dir, { recursive: true });
  const target = uniqueChildPath(dir, v.name);
  const abs = path.join(dir, target);
  assertInsideRoot(abs);
  fs.mkdirSync(abs, { recursive: false });
}

/** Read a note file as UTF-8 text. */
export function readNote(rel: string): { content: string; mtime: string; size: number } {
  const abs = absPath(rel);
  assertInsideRoot(abs);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) error("Not found", 404);
  const content = fs.readFileSync(abs, "utf8");
  const stat = fs.statSync(abs);
  return { content, mtime: stat.mtime.toISOString(), size: stat.size };
}

/** Atomically write a note file. Creates the file (and parent dirs) if missing;
 *  400 only when the target exists as a directory. */
export function writeNote(rel: string, content: string): { mtime: string; size: number } {
  const abs = absPath(rel);
  assertInsideRoot(abs);
  if (fs.existsSync(abs)) {
    if (!fs.statSync(abs).isFile()) error("Not a file", 400);
  }
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, abs);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
  const stat = fs.statSync(abs);
  return { mtime: stat.mtime.toISOString(), size: stat.size };
}

/** Rename a note or folder. For notes the sibling `.assets` folder moves too. */
export function renameEntry(rel: string, newName: string, isNote: boolean): { newRel: string } {
  const v = validateFileName(isNote ? newName.replace(/\.md$/i, "") : newName);
  if (!v.ok) error(v.message, 400);
  if (!isNote && (isNoteAssetsDir(v.name) || v.name.startsWith("."))) error("Invalid name", 400);

  const abs = absPath(rel);
  assertInsideRoot(abs);
  if (!fs.existsSync(abs)) error("Not found", 404);

  const name = isNote ? `${v.name}.md` : v.name;
  const dir = path.dirname(abs);
  const newAbs = path.join(dir, name);
  assertInsideRoot(newAbs);
  if (fs.existsSync(newAbs)) error("Already exists", 409);

  fs.renameSync(abs, newAbs);

  // Move the sibling attachments folder for notes.
  if (isNote) {
    const oldAssets = noteAssetsDir(rel);
    const newAssets = noteAssetsDir(newRelPath(rel, name));
    mvIfExists(notesRoot(), oldAssets, newAssets, absPath);
  }

  const parts = rel.split("/").filter(Boolean);
  parts[parts.length - 1] = name;
  return { newRel: parts.join("/") };
}

function newRelPath(oldRel: string, newName: string): string {
  const parts = oldRel.split("/").filter(Boolean);
  parts[parts.length - 1] = newName;
  return parts.join("/");
}

/** Move attachments folder (best-effort, ignore when absent). */
function mvIfExists(
  root: string,
  fromRel: string,
  toRel: string,
  resolver: (rel: string) => string,
): void {
  const from = resolver(fromRel);
  if (!fs.existsSync(from)) return;
  const to = resolver(toRel);
  // Cross-device-safe: copy then remove.
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
}

/** Delete a note (+ its attachments) or a folder (recursively). */
export function deleteEntry(rel: string, isNote: boolean): void {
  const abs = absPath(rel);
  assertInsideRoot(abs);
  if (!fs.existsSync(abs)) error("Not found", 404);
  if (isNote) {
    fs.rmSync(abs, { force: true });
    const assetsRel = noteAssetsDir(rel);
    const assetsAbs = absPath(assetsRel);
    if (fs.existsSync(assetsAbs)) fs.rmSync(assetsAbs, { recursive: true, force: true });
  } else {
    fs.rmSync(abs, { recursive: true, force: false });
  }
}

/** Move a note (+ its attachments) or a folder into destDir. Returns new relative path. */
export function moveEntry(rel: string, destDir: string, isNote: boolean): { newRel: string } | null {
  const abs = absPath(rel);
  assertInsideRoot(abs);
  if (!fs.existsSync(abs)) error("Not found", 404);

  const destAbs = destDir ? absPath(destDir) : notesRoot();
  assertInsideRoot(destAbs);
  if (!fs.statSync(destAbs).isDirectory()) error("Destination is not a directory", 400);

  // Refuse moving a folder into itself.
  if (fs.statSync(abs).isDirectory()) {
    const relp = path.relative(abs, destAbs);
    if (relp === "" || (!relp.startsWith("..") && !path.isAbsolute(relp))) {
      error("Cannot move a folder into itself", 400);
    }
  }

  const name = path.basename(abs);
  const newAbs = path.join(destAbs, name);
  assertInsideRoot(newAbs);
  if (fs.existsSync(newAbs)) error("Already exists", 409);
  if (path.resolve(newAbs) === path.resolve(abs)) return null;

  fs.renameSync(abs, newAbs);

  // Move the sibling attachments folder for notes.
  if (isNote) {
    const oldAssets = noteAssetsDir(rel);
    const targetAssets = destDir
      ? `${destDir}/${name.replace(/\.md$/i, "")}.assets`
      : `${name.replace(/\.md$/i, "")}.assets`;
    mvIfExists(notesRoot(), oldAssets, targetAssets, absPath);
  }

  const newRel = destDir ? `${destDir}/${name}` : name;
  return { newRel };
}

/** Store a pasted/dropped image for a note. Returns the note-relative path. */
export function saveNoteImage(
  noteRel: string,
  originalName: string,
  data: Buffer,
): { relPath: string; url: string } {
  const assetsRel = noteAssetsDir(noteRel);
  const assetsAbs = absPath(assetsRel);
  assertInsideRoot(assetsAbs);
  fs.mkdirSync(assetsAbs, { recursive: true });

  let ext = path.extname(originalName || "").toLowerCase();
  if (ext && !/^\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/.test(ext)) ext = "";
  const safeExt = ext || ".png";

  const stem = (path.basename(originalName || "image", path.extname(originalName || "image")) || "image")
    .replace(/[^\w\u4e00-\u9fa5-]/g, "-")
    .slice(0, 60);
  const fileName = `${Date.now()}-${stem || "image"}${safeExt}`;
  const finalName = uniqueChildPath(assetsAbs, fileName);
  const fileAbs = path.join(assetsAbs, finalName);
  assertInsideRoot(fileAbs);
  fs.writeFileSync(fileAbs, data);

  const relPath = `${assetsRel}/${finalName}`;
  const url = `/api/notes-file?p=${encodeURIComponent(relPath)}`;
  return { relPath, url };
}

/** Absolute path of any note-relative file (for serving media). */
export function resolveNoteFileAbs(rel: string): string {
  const abs = absPath(rel);
  assertInsideRoot(abs);
  if (!fs.existsSync(abs)) error("Not found", 404);
  return abs;
}