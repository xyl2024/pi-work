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
  parsePlanAnchor,
  parsePlanContent,
  parsePlanPath,
  planDirOf,
  sanitizePlanTitle,
  serializePlanContent,
  toLocalTimestamp,
  uniquePlanFileName,
  type Plan,
  type PlanAnchor,
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
  // Re-check the anchor here as well: `PlanAnchor`'s day date is only typed
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
      seen.add(resolvePlanPath(rel));
      const result = readPlanFile(rel);
      if ("plan" in result) plans.push(result.plan);
      else unsorted.push({ path: rel, problems: result.problems });
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
      seen.add(abs);
      const parsedPath = parsePlanPath(dirent.name);
      const problems = parsedPath.ok ? [] : parsedPath.problems;
      unsorted.push({ path: dirent.name, problems });
    }
  }

  // Drop cache entries for files that no longer exist.
  for (const key of cache.keys()) {
    if (!seen.has(key)) cache.delete(key);
  }

  return { plans, unsorted };
}
