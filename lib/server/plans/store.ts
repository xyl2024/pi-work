// Server-side plan file access.
//
// Plans are plain Markdown files under `<dataRoot>/user-plans/` (ADR-0006);
// this module is the only place that touches the filesystem for them. It
// scans the two layouts the panel knows (`inbox/` and `YYYY-MM/`), reads each
// file, creates new ones (atomic temp-file write), and reports names /
// frontmatter that break the contract as problems instead of throwing or
// rewriting anything.
//
// The scan keeps an in-process `mtime`+size cache: a re-read of an unchanged
// file reuses the parsed result. Nothing is persisted, nothing watches the
// directory (ADR-0006 accepts "refresh to see external edits").
//
// Every entry point validates that the resolved absolute path stays under the
// plans root (defence in depth, same shape as `lib/server/notes/store.ts`) —
// the cwd allow-root rules are deliberately not reused here.
import fs from "fs";
import path from "path";
import {
  movedPlanRelativePath,
  parsePlanAnchor,
  parsePlanContent,
  parsePlanPath,
  planAnchorsEqual,
  planDirOf,
  sanitizePlanTitle,
  serializePlanContent,
  toLocalTimestamp,
  uniquePlanFileName,
  type Plan,
  type PlanAnchor,
  type PlanConflictCode,
  type PlanMeta,
  type PlanProblem,
  type UnsortedPlan,
} from "@/lib/shared/plans";
import { dataPath } from "../data-dir";

/** Server-side mirror of the error shape used by the other file stores. */
export class PlanStoreError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * A 409 the panel answers with 「覆盖 / 重载到新位置」 — except for `name-taken`,
 * where nothing was written and there is nothing to overwrite or reload.
 */
export class PlanConflictError extends PlanStoreError {
  code: PlanConflictCode;
  /** For `missing`: where the same-titled plan lives now, when it can be found. */
  movedTo: string | null;
  /** For `name-taken`: the plan-relative path that is already occupied. */
  target: string | null;
  constructor(
    code: PlanConflictCode,
    message: string,
    movedTo: string | null = null,
    target: string | null = null,
  ) {
    super(message, 409);
    this.code = code;
    this.movedTo = movedTo;
    this.target = target;
  }
}

const MONTH_DIR_RE = /^\d{4}-\d{2}$/;

export function plansRoot(): string {
  return dataPath("user-plans");
}

/** Result of reading one plan file: the parsed plan, or why it is 待整理. */
export type PlanFileRead = { plan: Plan } | { problems: PlanProblem[] };

interface CacheEntry {
  mtimeMs: number;
  size: number;
  result: PlanFileRead;
}

const cache = new Map<string, CacheEntry>();

/** Normalize a plan-relative path: strip edge slashes, drop "." / "..". */
function normalizeRel(rel: string): string {
  return rel
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function assertInsideRoot(abs: string): void {
  const root = path.resolve(plansRoot());
  const resolved = path.resolve(abs);
  const rel = path.relative(root, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new PlanStoreError("Access denied", 403);
}

/** Absolute path of a plan-relative path, validated against the plans root. */
function resolvePlanPath(rel: string): string {
  const parts = normalizeRel(rel).split("/").filter(Boolean);
  const abs = parts.length === 0 ? plansRoot() : path.join(plansRoot(), ...parts);
  assertInsideRoot(abs);
  return abs;
}

/** Parse one file, reusing the cached result while mtime + size are unchanged. */
function readCandidate(rel: string, abs: string, stat: fs.Stats): PlanFileRead {
  const cached = cache.get(abs);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.result;
  }

  const parsedPath = parsePlanPath(rel);
  let result: PlanFileRead;
  if (!parsedPath.ok) {
    result = { problems: parsedPath.problems };
  } else {
    const parsed = parsePlanContent(fs.readFileSync(abs, "utf8"));
    result =
      parsed.problems.length > 0
        ? { problems: parsed.problems }
        : {
            plan: {
              path: rel,
              absPath: abs,
              title: parsedPath.title,
              anchor: parsedPath.anchor,
              done: parsed.meta.done,
              createdAt: parsed.meta.createdAt,
              doneAt: parsed.meta.doneAt,
              note: parsed.note,
              mtime: stat.mtime.toISOString(),
            },
          };
  }

  cache.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, result });
  return result;
}

/** Read one plan file by its plan-relative path. */
export function readPlanFile(rel: string): PlanFileRead {
  const abs = resolvePlanPath(rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new PlanStoreError("Not found", 404);
  }
  if (!stat.isFile()) throw new PlanStoreError("Not found", 404);
  return readCandidate(normalizeRel(rel), abs, stat);
}

/** Atomically write a plan file: temp file in the same directory + rename, so
 *  a reader never sees a half-written plan (same shape as the notes store).
 *  The temp name starts with "." and is therefore invisible to the scan. */
function writePlanFileAtomic(abs: string, content: string): void {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, abs);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export interface CreatePlanInput {
  title: string;
  anchor: PlanAnchor;
  /** Initial body (the 备注); the panel creates plans with an empty note. */
  note?: string;
}

/**
 * Create a plan file. The anchor decides the directory, the title becomes the
 * file name (sanitized and de-duplicated against what is already there), and
 * the frontmatter is stamped with `created_at` / `done: false` / empty
 * `done_at` — the only fields Pi Work ever writes on creation.
 *
 * Returns the plan exactly as a subsequent scan would report it, so the
 * create response and the list can never disagree.
 */
export function createPlan(input: CreatePlanInput): Plan {
  // Re-check the anchor here as well: `PlanAnchor`'s date / month fields are
  // as a string, and this is the value that becomes a path segment.
  const anchor = parsePlanAnchor(input.anchor);
  if (anchor === null) throw new PlanStoreError("Invalid anchor", 400);
  if (!sanitizePlanTitle(input.title)) throw new PlanStoreError("Title is required", 400);

  const dir = planDirOf(anchor);
  // `resolvePlanPath` is the single place that validates "inside the plans
  // root"; everything below is built from its output.
  const dirAbs = resolvePlanPath(dir);
  fs.mkdirSync(dirAbs, { recursive: true });

  const name = uniquePlanFileName(anchor, input.title, new Set(fs.readdirSync(dirAbs)));
  const rel = `${dir}/${name}`;
  const abs = resolvePlanPath(rel);
  // Cannot happen for a name picked from this directory's own listing; it is
  // what stops a create that raced another one from silently overwriting a
  // plan file (the rename below would replace it).
  if (fs.existsSync(abs)) throw new PlanStoreError("Already exists", 409);

  writePlanFileAtomic(
    abs,
    serializePlanContent(
      { done: false, createdAt: toLocalTimestamp(new Date()), doneAt: null },
      input.note ?? "",
    ),
  );
  cache.delete(abs);

  const read = readPlanFile(rel);
  if (!("plan" in read)) throw new PlanStoreError("Created plan could not be read back", 500);
  return read.plan;
}

export interface PlanScan {
  plans: Plan[];
  unsorted: UnsortedPlan[];
}

/**
 * Where a plan with this title lives now, if it was moved or renamed in a way
 * that kept the title.
 *
 * Deliberately conservative: only an unambiguous match counts. Title alone is
 * not identity, so when two plans share it the answer would be a coin flip and
 * the panel would offer to reload into someone else's plan — better to answer
 * "no idea" and let the user overwrite or look for themselves.
 */
function findMovedPlan(oldRel: string, title: string): string | null {
  const matches = listPlans()
    .plans.filter((plan) => plan.path !== oldRel && plan.title === title)
    .map((plan) => plan.path);
  return matches.length === 1 ? matches[0] : null;
}

/** A file that never parsed as a plan is never rewritten — serializing it would
 *  drop whatever the parser could not understand (ADR-0006). */
function unsortedWriteError(problems: readonly PlanProblem[]): PlanStoreError {
  const detail = problems.map((problem) => problem.code).join(", ");
  return new PlanStoreError(
    `This file does not follow the plan format (${detail}) and will not be rewritten`,
    422,
  );
}

export interface UpdatePlanInput {
  /** Plan-relative path of the file the panel has open. */
  path: string;
  /** New note body (the 备注); omitted leaves the body on disk alone. */
  note?: string;
  /** New completion state; the server owns `done_at` (stamp on done, clear on undo). */
  done?: boolean;
  /**
   * New time anchor; a change moves / renames the file (the anchor is the path,
   * ADR-0006). The title is preserved byte-for-byte, so only the anchor prefix
   * and the month directory differ after the move.
   */
  anchor?: PlanAnchor;
  /**
   * The `mtime` the client last saw. Required unless `force` — this is what
   * stops a stale editor from silently overwriting an agent's or another
   * editor's work.
   */
  expectedMtime?: string;
  /** The user picked 「覆盖」 after a 409: skip the guard and write anyway. */
  force?: boolean;
}

/**
 * Update a plan in place: the note, the completion state, the anchor, or any
 * combination.
 *
 * The file is read *at request time*, so a `done` toggle can never clobber an
 * external note edit — only a stale body can, and that is exactly what
 * `expectedMtime` guards. Writing to 待整理 files is refused instead of
 * serialized, and a vanished path comes back as a 409 the panel can resolve by
 * following the file to its new location (see `findMovedPlan`).
 *
 * A changed `anchor` is a move: the file is renamed into the new month
 * directory, which carries `created_at`, the note and the completion state over
 * untouched. A pure re-schedule does not even rewrite the bytes. If the target
 * name is already taken the write is refused — the other plan is never the one
 * that loses (see `PlanConflictError`).
 */
export function updatePlanFile(input: UpdatePlanInput): Plan {
  const rel = normalizeRel(input.path);
  const abs = resolvePlanPath(rel);

  if (input.done === undefined && input.note === undefined && input.anchor === undefined) {
    throw new PlanStoreError("Nothing to update", 400);
  }

  const parsedPath = parsePlanPath(rel);
  if (!parsedPath.ok) throw unsortedWriteError(parsedPath.problems);

  // A PATCH that restates the anchor already on the file is not a move; only a
  // *different* anchor renames anything. The title comes from the filename, so
  // the target path is the same contract the file already satisfied.
  const moving = input.anchor !== undefined && !planAnchorsEqual(input.anchor, parsedPath.anchor);
  const targetRel = moving ? movedPlanRelativePath(input.anchor!, parsedPath.title) : rel;
  const targetAbs = moving ? resolvePlanPath(targetRel) : abs;

  // Never land on another plan. Case-insensitive for the same reason the create
  // path is: a case-blind filesystem must not let one plan silently eat another.
  //
  // Deliberately checked *before* the mtime guard below: an occupied target is
  // a hard stop, and the panel's 「覆盖」 (`force`) must not clobber the other
  // plan either. A stale view only changes which error the user is shown.
  if (moving) {
    const targetDir = path.dirname(targetAbs);
    const wanted = path.basename(targetAbs).toLowerCase();
    if (
      fs.existsSync(targetDir) &&
      fs.readdirSync(targetDir).some((name) => name.toLowerCase() === wanted)
    ) {
      throw new PlanConflictError(
        "name-taken",
        "A plan with that name already exists in the target month",
        null,
        targetRel,
      );
    }
  }

  let stat: fs.Stats | null = null;
  try {
    const found = fs.statSync(abs);
    if (found.isFile()) stat = found;
  } catch {
    /* handled as "missing" below */
  }

  if (stat === null && !input.force) {
    throw new PlanConflictError(
      "missing",
      "The plan file is gone",
      findMovedPlan(rel, parsedPath.title),
    );
  }

  let meta: PlanMeta;
  let note: string;
  if (stat === null) {
    // 「覆盖」 on a path that no longer exists recreates the file there. The old
    // bytes are gone, so `created_at` restarts now — the one field that cannot
    // be restored.
    meta = { done: false, createdAt: toLocalTimestamp(new Date()), doneAt: null };
    note = input.note ?? "";
  } else {
    if (!input.force) {
      if (typeof input.expectedMtime !== "string") {
        throw new PlanStoreError("expectedMtime is required", 400);
      }
      if (input.expectedMtime !== stat.mtime.toISOString()) {
        throw new PlanConflictError("modified", "The plan file changed on disk");
      }
    }
    const parsed = parsePlanContent(fs.readFileSync(abs, "utf8"));
    if (parsed.problems.length > 0) throw unsortedWriteError(parsed.problems);
    meta = { ...parsed.meta };
    note = input.note ?? parsed.note;
  }

  let doneChanged = false;
  if (input.done !== undefined && input.done !== meta.done) {
    meta.done = input.done;
    meta.doneAt = input.done ? toLocalTimestamp(new Date()) : null;
    doneChanged = true;
  }

  if (stat === null) {
    // Nothing to rename: the recreated plan is written straight to the target.
    writePlanFileAtomic(targetAbs, serializePlanContent(meta, note));
  } else {
    if (input.note !== undefined || doneChanged) {
      writePlanFileAtomic(abs, serializePlanContent(meta, note));
    }
    if (moving) {
      // A pure re-schedule is a rename of untouched bytes, so `created_at`, the
      // note and the completion state survive by construction. `rename` is
      // atomic on one filesystem, which the plans root is.
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.renameSync(abs, targetAbs);
    }
  }

  cache.delete(abs);
  cache.delete(targetAbs);

  const read = readPlanFile(targetRel);
  if (!("plan" in read)) throw new PlanStoreError("Updated plan could not be read back", 500);
  return read.plan;
}

/**
 * Delete a plan file. Deletion is explicit — the panel asks for confirmation
 * first — and it never rewrites bytes, so 待整理 files can be removed too.
 */
export function deletePlanFile(rel: string): void {
  const abs = resolvePlanPath(rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new PlanStoreError("Not found", 404);
  }
  if (!stat.isFile()) throw new PlanStoreError("Not found", 404);
  fs.rmSync(abs, { force: true });
  cache.delete(abs);
}

/**
 * Scan the plans root. Only `inbox/` and `YYYY-MM/` directories are read;
 * other directories are left alone. Markdown files directly under the root
 * have no valid layout and land in 待整理.
 */
export function listPlans(refresh = false): PlanScan {
  if (refresh) cache.clear();

  const root = plansRoot();
  fs.mkdirSync(root, { recursive: true });

  const seen = new Set<string>();
  const plans: Plan[] = [];
  const unsorted: UnsortedPlan[] = [];

  const collect = (rel: string) => {
    try {
      const abs = resolvePlanPath(rel);
      seen.add(abs);
      const result = readPlanFile(rel);
      if ("plan" in result) plans.push(result.plan);
      else unsorted.push({ path: rel, absPath: abs, problems: result.problems });
    } catch (error) {
      // The file vanished between readdir and read — leave it out. Any other
      // failure (permissions, …) is a real error and must surface, not be
      // silently dropped from the list.
      if (!(error instanceof PlanStoreError)) throw error;
    }
  };

  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (dirent.name.startsWith(".")) continue;
    const abs = path.join(root, dirent.name);

    if (dirent.isDirectory()) {
      if (dirent.name !== "inbox" && !MONTH_DIR_RE.test(dirent.name)) continue;
      for (const file of fs.readdirSync(abs, { withFileTypes: true })) {
        if (!file.isFile() || file.name.startsWith(".")) continue;
        if (!file.name.toLowerCase().endsWith(".md")) continue;
        collect(`${dirent.name}/${file.name}`);
      }
      continue;
    }

    if (dirent.isFile() && dirent.name.toLowerCase().endsWith(".md")) {
      // A markdown file directly under the root is in neither layout the
      // contract allows, so it is 待整理 for the reason `collect` reports for
      // it: a path without a `<dir>/` segment (ADR-0006).
      collect(dirent.name);
    }
  }

  // Drop cache entries for files that no longer exist.
  for (const key of cache.keys()) {
    if (!seen.has(key)) cache.delete(key);
  }

  // `readdir` order is whatever the filesystem hands back. The panel lists this
  // feed as-is, so sort it here: a stable order is what makes "it moved out of
  // 待整理 after I fixed it" observable rather than a reshuffle.
  unsorted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { plans, unsorted };
}
