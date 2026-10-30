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

    let mtime: string | null = null;
    try {
      const after = fs.statSync(filePath);
      mtime = after.mtime.toISOString();
    } catch {
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

export const FILE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

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
      const rel = rawRel
        .replace(/\\/g, "/")
        .split("/")
        .filter((s) => s.length > 0 && s !== ".");
      if (rel.length === 0 || rel.some((s) => s === "..")) {
        failed.push({ path: rawRel, error: "Invalid path" });
        continue;
      }

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
      if (IGNORED_NAMES.has(rel[0]) || IGNORED_SUFFIXES.some((s) => rel[0].endsWith(s))) {
        failed.push({ path: rawRel, error: "Ignored name" });
        continue;
      }

      const target = path.join(parentPath, ...rel);
      if (!isPathAllowed(target, allowedRoots)) {
        failed.push({ path: rawRel, error: "Access denied" });
        continue;
      }
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
    if (op === "duplicate") {
      return await handleFileDuplicate(segments);
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

function uniqueCopyPath(dir: string, filename: string): string {
  const parsed = path.parse(filename);
  let candidate = path.join(dir, `${parsed.name} copy${parsed.ext}`);
  let n = 2;
  while (fs.existsSync(candidate) && n <= 1000) {
    candidate = path.join(dir, `${parsed.name} copy ${n}${parsed.ext}`);
    n += 1;
  }
  return candidate;
}

export async function handleFileDuplicate(segments: string[]) {
  const startedAt = Date.now();
  try {
    const sourcePath = filePathFromSegments(segments);
    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(sourcePath, allowedRoots)) {
      log.warn("file duplicate denied", { path: sourcePath, durationMs: elapsedMs(startedAt) });
      return jsonError("Access denied", 403);
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(sourcePath);
    } catch {
      return jsonError("Not found", 404);
    }
    if (!stat.isFile()) {
      return jsonError("Not a file", 400);
    }

    const dir = path.dirname(sourcePath);
    const newPath = uniqueCopyPath(dir, path.basename(sourcePath));
    if (!isPathAllowed(newPath, allowedRoots)) {
      return jsonError("Access denied", 403);
    }

    fs.copyFileSync(sourcePath, newPath);
    log.info("file duplicated", { from: sourcePath, to: newPath, durationMs: elapsedMs(startedAt) });
    return jsonOk({ path: newPath, oldPath: sourcePath });
  } catch (error) {
    log.error("file duplicate failed", { error, durationMs: elapsedMs(startedAt) });
    return jsonError(String(error), 500);
  }
}

export async function handleFileDelete(segments: string[], options: { recursive?: boolean } = {}) {
  const startedAt = Date.now();
  try {
    const targetPath = filePathFromSegments(segments);
    log.debug("file delete received", { path: targetPath, recursive: options.recursive === true });

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
      const resolvedTarget = path.resolve(targetPath);
      for (const root of allowedRoots) {
        if (path.resolve(root) === resolvedTarget) {
          log.warn("file delete denied (root)", { path: targetPath, durationMs: elapsedMs(startedAt) });
          return jsonError("Access denied", 403);
        }
      }

      if (options.recursive === true) {
        fs.rmSync(targetPath, { recursive: true, force: false });
      } else {
        const names = fs.readdirSync(targetPath);
        if (names.length > 0) {
          return jsonError("Directory not empty", 400);
        }
        fs.rmdirSync(targetPath);
      }
    } else {
      fs.unlinkSync(targetPath);
    }

    invalidateAllowedRootsCache();
    log.info("file deleted", { path: targetPath, isDir: stat.isDirectory(), recursive: options.recursive === true, durationMs: elapsedMs(startedAt) });
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

    if (op !== "rename" && op !== "move") {
      return jsonError("Invalid PATCH type", 400);
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(oldPath, allowedRoots)) {
      log.warn("file patch denied", { op, path: oldPath, durationMs: elapsedMs(startedAt) });
      return jsonError("Access denied", 403);
    }

    if (op === "move") {
      return handleFileMove(request, oldPath, allowedRoots, startedAt);
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

    fs.renameSync(oldPath, newPath);
    invalidateAllowedRootsCache();
    log.info("file renamed", { from: oldPath, to: newPath, durationMs: elapsedMs(startedAt) });
    return jsonOk({ path: newPath, oldPath });
  } catch (error) {
    log.error("file rename failed", { error, durationMs: elapsedMs(startedAt) });
    return jsonError(String(error), 500);
  }
}

async function handleFileMove(
  request: NextRequest,
  oldPath: string,
  allowedRoots: Set<string>,
  startedAt: number,
): Promise<NextResponse> {
  let body: { destDir?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (typeof body.destDir !== "string" || body.destDir.length === 0) {
    return jsonError("Missing 'destDir' field", 400);
  }
  const destDir = body.destDir;

  if (!isPathAllowed(destDir, allowedRoots)) {
    log.warn("file move denied", { path: oldPath, destDir, durationMs: elapsedMs(startedAt) });
    return jsonError("Access denied", 403);
  }

  if (!fs.existsSync(oldPath)) {
    return jsonError("Not found", 404);
  }

  let destStat: fs.Stats;
  try {
    destStat = fs.statSync(destDir);
  } catch {
    return jsonError("Destination not found", 404);
  }
  if (!destStat.isDirectory()) {
    return jsonError("Destination is not a directory", 400);
  }

  const name = path.basename(oldPath);
  const newPath = path.join(destDir, name);
  if (path.resolve(newPath) === path.resolve(oldPath)) {
    return jsonOk({ path: oldPath, oldPath });
  }
  if (!isPathAllowed(newPath, allowedRoots)) {
    return jsonError("Access denied", 403);
  }

  if (fs.statSync(oldPath).isDirectory()) {
    const rel = path.relative(oldPath, destDir);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return jsonError("Cannot move a folder into itself", 400);
    }
  }

  if (fs.existsSync(newPath)) {
    return jsonError("Already exists", 409);
  }

  fs.renameSync(oldPath, newPath);
  log.info("file moved", { from: oldPath, to: newPath, durationMs: elapsedMs(startedAt) });
  return jsonOk({ path: newPath, oldPath });
}
