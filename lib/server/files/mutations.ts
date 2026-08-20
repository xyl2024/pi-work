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

    fs.writeFileSync(filePath, body.content, "utf-8");

    log.info("file written", {
      path: filePath,
      size: body.content.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ ok: true, size: body.content.length });
  } catch (error) {
    log.error("file write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function handleFilePost(request: NextRequest, segments: string[]) {
  const startedAt = Date.now();
  try {
    const parentPath = filePathFromSegments(segments);
    const op = request.nextUrl.searchParams.get("type") ?? "create";
    log.debug("file mutation received", { op, parent: parentPath });

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
