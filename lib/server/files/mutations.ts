import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { validateFileName } from "@/lib/shared/file-name";
import {
  filePathFromSegments,
  getAllowedRoots,
  invalidateAllowedRootsCache,
  isPathAllowed,
} from "@/lib/server/file-access";
import { IGNORED_NAMES, IGNORED_SUFFIXES, jsonError, jsonOk } from "./handler";

const log = createLogger("api/files");

/** Max size (in bytes) we accept from PUT. Mirrors the soft "5MB
 *  warning / 50MB degrade" UX in the right-side viewer (see
 *  components/files/file-viewer/MonacoViewer.tsx) — anything larger
 *  should be written via the agent's Write tool, not the inline
 *  editor. 10 MiB. */
export const FILE_PUT_MAX_BYTES = 10 * 1024 * 1024;

export async function handleFilePut(request: NextRequest, segments: string[]) {
  const startedAt = Date.now();
  try {
    const filePath = filePathFromSegments(segments);
    log.debug("file write request received", { path: filePath });

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(filePath, allowedRoots)) {
      log.warn("file write denied", { path: filePath, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      log.warn("file write target not found", { path: filePath, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!stat.isFile()) {
      log.warn("file write rejected", { path: filePath, reason: "not a file", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Not a file" }, { status: 400 });
    }

    let body: { content?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'content' field" }, { status: 400 });
    }

    // Size limit. `Buffer.byteLength` measures UTF-8 bytes (the way the
    // file will be written), not the JS string length — emoji and CJK
    // characters cost more than code units.
    const byteLength = Buffer.byteLength(body.content, "utf-8");
    if (byteLength > FILE_PUT_MAX_BYTES) {
      log.warn("file write rejected", {
        path: filePath,
        reason: "too large",
        bytes: byteLength,
        limitBytes: FILE_PUT_MAX_BYTES,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json(
        {
          error: `File too large: ${(byteLength / 1024 / 1024).toFixed(1)} MB exceeds the ${FILE_PUT_MAX_BYTES / 1024 / 1024} MB write limit`,
          code: "FILE_TOO_LARGE",
          sizeBytes: byteLength,
          limitBytes: FILE_PUT_MAX_BYTES,
        },
        { status: 413 },
      );
    }

    fs.writeFileSync(filePath, body.content, "utf-8");

    // Read mtime from a fresh stat so the client can refresh its
    // status-bar display without an extra GET round-trip.
    let mtime: string | null = null;
    try {
      const after = fs.statSync(filePath);
      mtime = after.mtime.toISOString();
    } catch {
      // File vanished between write and stat — odd but not fatal for the
      // caller; they'll see the size and know the write itself succeeded.
    }

    log.info("file written", {
      path: filePath,
      size: byteLength,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ ok: true, size: byteLength, mtime });
  } catch (error) {
    log.error("file write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Max size (in bytes) per uploaded file. Generous enough for binaries
 *  the inline editor would refuse (the 10 MiB PUT cap targets text
 *  editing), while keeping the whole formData comfortably in memory. */
export const FILE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** Hard cap on the number of files per upload request (directory uploads
 *  can otherwise explode into thousands of form entries). */
export const FILE_UPLOAD_MAX_FILES = 2000;

export async function handleFileUpload(request: NextRequest, segments: string[]) {
  const startedAt = Date.now();
  try {
    const parentPath = filePathFromSegments(segments);
    log.debug("file upload received", { parent: parentPath });

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(parentPath, allowedRoots)) {
      log.warn("file upload denied", { parent: parentPath, durationMs: elapsedMs(startedAt) });
      return jsonError("Access denied", 403);
    }

    let parentStat: fs.Stats;
    try {
      parentStat = fs.statSync(parentPath);
    } catch {
      return jsonError("Parent not found", 404);
    }
    if (!parentStat.isDirectory()) {
      return jsonError("Parent is not a directory", 400);
    }

    // Multipart form: for each file the client appends a "file" entry and
    // a matching "path" entry carrying the webkitRelativePath (so folder
    // uploads land in subdirectories). Index i of both lists corresponds.
    const form = await request.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    const paths = form.getAll("path").map((p) => String(p));
    if (files.length === 0) {
      return jsonError("No files provided", 400);
    }
    if (files.length > FILE_UPLOAD_MAX_FILES) {
      return jsonError(`Too many files (max ${FILE_UPLOAD_MAX_FILES})`, 400);
    }

    let uploaded = 0;
    let skipped = 0;
    const failed: { path: string; error: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rawRel = paths[i] ?? file.name;
      // Normalize the relative path: strip drive/backslashes/"./" and
      // reject traversal ("..") outright — the client sends this value,
      // so it is untrusted input.
      const rel = rawRel
        .replace(/\\/g, "/")
        .split("/")
        .filter((s) => s.length > 0 && s !== ".");
      if (rel.length === 0 || rel.some((s) => s === "..")) {
        failed.push({ path: rawRel, error: "Invalid path" });
        continue;
      }

      // Same name rules as create/rename for every path segment...
      let invalid: string | null = null;
      for (const seg of rel) {
        const v = validateFileName(seg);
        if (!v.ok) {
          invalid = v.message;
          break;
        }
      }
      if (invalid) {
        failed.push({ path: rawRel, error: invalid });
        continue;
      }
      // ...and the same ignore-list guard for the top-level entry, so an
      // explicit upload can't materialize e.g. a fresh "node_modules" at
      // the workspace root (nested ignored dirs are allowed — blocking a
      // whole folder upload because it *contains* one would be hostile).
      if (IGNORED_NAMES.has(rel[0]) || IGNORED_SUFFIXES.some((s) => rel[0].endsWith(s))) {
        failed.push({ path: rawRel, error: "Ignored name" });
        continue;
      }

      const target = path.join(parentPath, ...rel);
      if (!isPathAllowed(target, allowedRoots)) {
        failed.push({ path: rawRel, error: "Access denied" });
        continue;
      }
      // Existing entries are skipped, never overwritten — an accidental
      // re-upload must not silently clobber user edits.
      if (fs.existsSync(target)) {
        skipped++;
        continue;
      }
      if (file.size > FILE_UPLOAD_MAX_BYTES) {
        failed.push({
          path: rawRel,
          error: `File too large (max ${Math.floor(FILE_UPLOAD_MAX_BYTES / 1024 / 1024)} MB)`,
        });
        continue;
      }

      try {
        const dir = path.dirname(target);
        if (dir !== parentPath) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()));
        uploaded++;
      } catch (e) {
        failed.push({ path: rawRel, error: String(e) });
      }
    }

    if (uploaded > 0) invalidateAllowedRootsCache();
    log.info("file upload finished", {
      parent: parentPath,
      uploaded,
      skipped,
      failed: failed.length,
      durationMs: elapsedMs(startedAt),
    });
    return jsonOk({ uploaded, skipped, failed });
  } catch (error) {
    log.error("file upload failed", { error, durationMs: elapsedMs(startedAt) });
    return jsonError(String(error), 500);
  }
}

export async function handleFilePost(request: NextRequest, segments: string[]) {
  const startedAt = Date.now();
  try {
    const parentPath = filePathFromSegments(segments);
    const op = request.nextUrl.searchParams.get("type") ?? "create";
    log.debug("file mutation received", { op, parent: parentPath });

    if (op === "upload") {
      return await handleFileUpload(request, segments);
    }
    if (op !== "mkdir" && op !== "create") {
      return jsonError("Invalid POST type", 400);
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(parentPath, allowedRoots)) {
      log.warn("file mutation denied", { op, parent: parentPath, durationMs: elapsedMs(startedAt) });
      return jsonError("Access denied", 403);
    }

    let body: { name?: string; content?: string; recursive?: boolean };
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
    if (typeof body.name !== "string") {
      return jsonError("Missing 'name' field", 400);
    }

    const v = validateFileName(body.name);
    if (!v.ok) {
      return jsonError(v.message, 400);
    }
    const name = v.name;

    if (IGNORED_NAMES.has(name) || IGNORED_SUFFIXES.some((s) => name.endsWith(s))) {
      return jsonError("Cannot create ignored directory", 400);
    }

    // Parent must exist and be a directory
    let parentStat: fs.Stats;
    try {
      parentStat = fs.statSync(parentPath);
    } catch {
      return jsonError("Parent not found", 404);
    }
    if (!parentStat.isDirectory()) {
      return jsonError("Parent is not a directory", 400);
    }

    const target = path.join(parentPath, name);
    if (!isPathAllowed(target, allowedRoots)) {
      return jsonError("Access denied", 403);
    }
    if (fs.existsSync(target)) {
      return jsonError("Already exists", 409);
    }

    if (op === "mkdir") {
      fs.mkdirSync(target, { recursive: body.recursive === true });
      invalidateAllowedRootsCache();
      log.info("directory created", { path: target, durationMs: elapsedMs(startedAt) });
      return jsonOk({ path: target });
    }

    // op === "create" — empty file with optional initial content
    const content = typeof body.content === "string" ? body.content : "";
    fs.writeFileSync(target, content, "utf-8");
    invalidateAllowedRootsCache();
    log.info("file created", { path: target, size: content.length, durationMs: elapsedMs(startedAt) });
    return jsonOk({ path: target, size: content.length });
  } catch (error) {
    log.error("file mutation failed", { error, durationMs: elapsedMs(startedAt) });
    return jsonError(String(error), 500);
  }
}

export async function handleFileDelete(segments: string[]) {
  const startedAt = Date.now();
  try {
    const targetPath = filePathFromSegments(segments);
    log.debug("file delete received", { path: targetPath });

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(targetPath, allowedRoots)) {
      log.warn("file delete denied", { path: targetPath, durationMs: elapsedMs(startedAt) });
      return jsonError("Access denied", 403);
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(targetPath);
    } catch {
      return jsonError("Not found", 404);
    }

    if (stat.isDirectory()) {
      const names = fs.readdirSync(targetPath);
      if (names.length > 0) {
        return jsonError("Directory not empty", 400);
      }
      fs.rmdirSync(targetPath);
    } else {
      fs.unlinkSync(targetPath);
    }

    invalidateAllowedRootsCache();
    log.info("file deleted", { path: targetPath, isDir: stat.isDirectory(), durationMs: elapsedMs(startedAt) });
    return jsonOk({ path: targetPath });
  } catch (error) {
    log.error("file delete failed", { error, durationMs: elapsedMs(startedAt) });
    return jsonError(String(error), 500);
  }
}

export async function handleFilePatch(request: NextRequest, segments: string[]) {
  const startedAt = Date.now();
  try {
    const oldPath = filePathFromSegments(segments);
    const op = request.nextUrl.searchParams.get("type") ?? "rename";
    log.debug("file patch received", { op, path: oldPath });

    if (op !== "rename") {
      return jsonError("Invalid PATCH type", 400);
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(oldPath, allowedRoots)) {
      log.warn("file rename denied", { path: oldPath, durationMs: elapsedMs(startedAt) });
      return jsonError("Access denied", 403);
    }

    let body: { newName?: string };
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
    if (typeof body.newName !== "string") {
      return jsonError("Missing 'newName' field", 400);
    }

    const v = validateFileName(body.newName);
    if (!v.ok) {
      return jsonError(v.message, 400);
    }
    const newName = v.name;

    if (IGNORED_NAMES.has(newName) || IGNORED_SUFFIXES.some((s) => newName.endsWith(s))) {
      return jsonError("Cannot rename to ignored name", 400);
    }

    if (!fs.existsSync(oldPath)) {
      return jsonError("Not found", 404);
    }

    const parentDir = path.dirname(oldPath);
    const newPath = path.join(parentDir, newName);
    if (!isPathAllowed(newPath, allowedRoots)) {
      return jsonError("Access denied", 403);
    }
    if (fs.existsSync(newPath)) {
      return jsonError("Already exists", 409);
    }

    // fs.renameSync throws on cross-device moves; we explicitly want same-dir only,
    // but the safety net is that `newPath` is computed from `path.dirname(oldPath)`.
    fs.renameSync(oldPath, newPath);
    invalidateAllowedRootsCache();
    log.info("file renamed", { from: oldPath, to: newPath, durationMs: elapsedMs(startedAt) });
    return jsonOk({ path: newPath, oldPath });
  } catch (error) {
    log.error("file rename failed", { error, durationMs: elapsedMs(startedAt) });
    return jsonError(String(error), 500);
  }
}
