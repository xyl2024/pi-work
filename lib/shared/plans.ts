// Pure domain module for the Plans feature (right-panel view "Plans").
//
// Every decision-dense rule of the feature lives here and nowhere else: date
// keys, filename ↔ anchor + title round-tripping, the lenient frontmatter
// contract, the sections and their ordering. This module is in the shared
// layer on purpose — no `fs`, no `path`, no Node APIs, no React — so all of it
// is unit-testable without a server or a browser (ADR-0002 / ADR-0006 keep the
// same shape for `panelTabs` and `tool-call-display`).
//
// Data layout (ADR-0006), relative to `<dataRoot>/user-plans/`:
//
//   inbox/<title>.md                     no anchor
//   YYYY-MM/YYYY-MM-DD-<title>.md        day anchor
//
// The anchor is the single source of truth and lives in the *path*; the
// frontmatter carries only `done` / `created_at` / `done_at`. Week and month
// anchors are added by a later slice of the same feature.

// ── Date keys ────────────────────────────────────────────────────────────

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

/**
 * Local-calendar `YYYY-MM-DD` key. "Today" is always the *browser's* local
 * date: the client computes this key and hands it to the server, which never
 * guesses a timezone.
 */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30, 2026-2-8). */
export function isDateKey(value: string): boolean {
  const match = DATE_KEY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** The `YYYY-MM` month directory a date key belongs to. */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/**
 * Timestamp in the frontmatter's canonical shape, in the *writer's* local
 * zone: `2026-09-14T22:03:11+08:00`. Written as an explicit offset (never
 * `Z`) so the file says which wall clock it was made in; the parser accepts
 * both.
 */
export function toLocalTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${toDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ── Anchors ──────────────────────────────────────────────────────────────
// Same lexical ordering as calendar order, which is why the rest of the
// module compares date keys as plain strings.

export type PlanAnchor =
  | { kind: "inbox" }
  | { kind: "day"; date: string };

export type PlanAnchorKind = PlanAnchor["kind"];

/**
 * Parse an anchor out of untrusted input (a request body). Returns `null`
 * for anything that is not the inbox or a real day — in particular a date
 * carrying path syntax, which is what keeps a client-supplied anchor from
 * steering the write outside the plans root.
 */
export function parsePlanAnchor(value: unknown): PlanAnchor | null {
  if (typeof value !== "object" || value === null) return null;
  const anchor = value as { kind?: unknown; date?: unknown };
  if (anchor.kind === "inbox") return { kind: "inbox" };
  if (anchor.kind === "day" && typeof anchor.date === "string" && isDateKey(anchor.date)) {
    return { kind: "day", date: anchor.date };
  }
  return null;
}

// ── Parse problems (the 待整理 feed) ──────────────────────────────────────
// A problem is a machine-readable code plus the offending fragment; the panel
// turns a code into a translated sentence (full 待整理 UI lands in a later
// slice). Parsing never throws and never rewrites the file.

export type PlanProblemCode =
  | "name-syntax"
  | "date-invalid"
  | "month-mismatch"
  | "location"
  | "frontmatter-syntax"
  | "frontmatter-done"
  | "frontmatter-created-at"
  | "frontmatter-done-at";

export interface PlanProblem {
  code: PlanProblemCode;
  /** Offending value / fragment, for the detail line. */
  detail?: string;
}

function problem(code: PlanProblemCode, detail?: string): PlanProblem {
  return detail === undefined ? { code } : { code, detail };
}

// ── Path ↔ anchor + title ────────────────────────────────────────────────

export type PlanPathParse =
  | { ok: true; anchor: PlanAnchor; title: string }
  | { ok: false; problems: PlanProblem[] };

const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

function parseFailure(code: PlanProblemCode, detail: string): PlanPathParse {
  return { ok: false, problems: [problem(code, detail)] };
}

/**
 * Read the anchor and title out of a plan-relative path
 * (e.g. `2026-09/2026-09-15-去办居住证.md`). The title is the filename minus
 * the anchor prefix and `.md` — there is no `title` field to disagree with it.
 *
 * Anything that does not match the contract comes back as problems instead of
 * throwing; the caller shows it in 待整理.
 */
export function parsePlanPath(relPath: string): PlanPathParse {
  const segments = relPath.split("/").filter(Boolean);
  if (segments.length !== 2) return parseFailure("location", relPath);
  const [dir, fileName] = segments;
  if (!fileName.toLowerCase().endsWith(".md")) return parseFailure("name-syntax", fileName);
  const stem = fileName.slice(0, -3);

  if (dir === "inbox") {
    if (!stem.trim()) return parseFailure("name-syntax", fileName);
    return { ok: true, anchor: { kind: "inbox" }, title: stem };
  }

  if (!MONTH_KEY_RE.test(dir)) return parseFailure("location", relPath);

  const match = DAY_FILE_RE.exec(stem);
  if (!match) return parseFailure("name-syntax", fileName);
  const date = match[1];
  const title = match[2];
  if (!isDateKey(date)) return parseFailure("date-invalid", date);
  if (monthKeyOf(date) !== dir) {
    return parseFailure("month-mismatch", `${dir} ≠ ${monthKeyOf(date)}`);
  }
  if (!title.trim()) return parseFailure("name-syntax", fileName);
  return { ok: true, anchor: { kind: "day", date }, title };
}

// ── Title + filename generation ──────────────────────────────────────────

/** Longest title Pi Work will encode into a filename. */
export const PLAN_TITLE_MAX_LENGTH = 80;

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
const EDGE_JUNK = /^[\s.-]+|[\s.-]+$/g;

/**
 * Turn a title into the filename fragment Pi Work will use: path-illegal
 * characters become `-`, runs of whitespace collapse, edge junk is trimmed and
 * the result is capped at `PLAN_TITLE_MAX_LENGTH`. May return "" for a title
 * that is nothing but illegal characters — callers reject that.
 */
export function sanitizePlanTitle(raw: string): string {
  return raw
    .replace(ILLEGAL_FILENAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(EDGE_JUNK, "")
    .slice(0, PLAN_TITLE_MAX_LENGTH)
    .replace(EDGE_JUNK, "");
}

const NO_NAMES: ReadonlySet<string> = new Set<string>();

/**
 * File name for a plan (`2026-09-15-去办居住证.md`, `随手记.md`), assuming the
 * name is still free in its directory. `uniquePlanFileName` is the variant
 * that deals with the names already there.
 */
export function planFileName(anchor: PlanAnchor, title: string): string {
  return uniquePlanFileName(anchor, title, NO_NAMES);
}

/** Directory (relative to the plans root) holding every plan of an anchor. */
export function planDirOf(anchor: PlanAnchor): string {
  return anchor.kind === "inbox" ? "inbox" : monthKeyOf(anchor.date);
}

/** Plan-relative path for a plan, i.e. the inverse of `parsePlanPath`. */
export function planRelativePath(anchor: PlanAnchor, title: string): string {
  return `${planDirOf(anchor)}/${planFileName(anchor, title)}`;
}

/**
 * File name for a plan that does not collide with `taken` — the file names
 * already present in its directory (any case: the check is case-insensitive
 * so a case-blind filesystem cannot be silently overwritten). On a collision
 * a `-2` / `-3` suffix is appended, and the title is shortened to keep the
 * whole title within `PLAN_TITLE_MAX_LENGTH`.
 *
 * Pure on purpose: the caller hands in the directory listing, so the naming
 * rule is testable without touching a filesystem.
 */
export function uniquePlanFileName(
  anchor: PlanAnchor,
  title: string,
  taken: ReadonlySet<string>,
): string {
  const prefix = anchor.kind === "inbox" ? "" : `${anchor.date}-`;
  const base = sanitizePlanTitle(title);
  const existing = new Set([...taken].map((name) => name.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? "" : `-${n}`;
    const clean = sanitizePlanTitle(base.slice(0, PLAN_TITLE_MAX_LENGTH - suffix.length));
    const name = `${prefix}${clean}${suffix}.md`;
    if (!existing.has(name.toLowerCase())) return name;
  }
}

// ── Frontmatter (lenient) ────────────────────────────────────────────────

export interface PlanMeta {
  done: boolean;
  createdAt: string | null;
  doneAt: string | null;
}

export interface PlanContentParse {
  meta: PlanMeta;
  /** Body after the frontmatter block (the 备注). */
  note: string;
  problems: PlanProblem[];
}

const DEFAULT_META: PlanMeta = { done: false, createdAt: null, doneAt: null };
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function parseTimestamp(
  value: string | undefined,
  code: PlanProblemCode,
  problems: PlanProblem[],
): string | null {
  if (value === undefined || value === "") return null;
  if (!ISO_DATETIME_RE.test(value) || Number.isNaN(Date.parse(value))) {
    problems.push(problem(code, value));
    return null;
  }
  return value;
}

/** Strip one pair of matching quotes from a scalar, if present. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse a plan file's content into its metadata plus note body.
 *
 * Leniency is the contract (a hand-written file must not need Pi Work to be
 * valid to be useful): a file with no frontmatter at all is a plan with the
 * defaults; missing keys default; unknown keys are ignored for forward
 * compatibility. Only *unparseable* values and a malformed block are reported
 * as problems, and the file is never rewritten.
 */
export function parsePlanContent(content: string): PlanContentParse {
  const text = content.replace(/^\uFEFF/, "");
  const match = FRONTMATTER_RE.exec(text);

  if (!match) {
    const problems: PlanProblem[] = [];
    // A `---` line that never closes is a broken block, not an absent one —
    // say so instead of silently swallowing it as note text.
    if (/^---[ \t]*\r?\n/.test(text)) {
      problems.push(problem("frontmatter-syntax", "unterminated frontmatter"));
    }
    return { meta: { ...DEFAULT_META }, note: text.trim(), problems };
  }

  const problems: PlanProblem[] = [];
  const values = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      problems.push(problem("frontmatter-syntax", trimmed));
      continue;
    }
    values.set(trimmed.slice(0, colon).trim(), unquote(trimmed.slice(colon + 1).trim()));
  }

  const meta: PlanMeta = { ...DEFAULT_META };
  const done = values.get("done");
  if (done !== undefined && done !== "") {
    if (done === "true" || done === "false") meta.done = done === "true";
    else problems.push(problem("frontmatter-done", done));
  }
  meta.createdAt = parseTimestamp(values.get("created_at"), "frontmatter-created-at", problems);
  meta.doneAt = parseTimestamp(values.get("done_at"), "frontmatter-done-at", problems);

  return { meta, note: text.slice(match[0].length).trim(), problems };
}

/**
 * Write `meta` + `note` back out in the canonical file shape: the three
 * frontmatter fields in a fixed order, then the note as the body. This is the
 * only serializer — Pi Work never rewrites a file it did not create itself
 * (待整理 files keep their original bytes).
 */
export function serializePlanContent(meta: PlanMeta, note = ""): string {
  const body = note.trim();
  const line = (key: string, value: string | null) => `${key}:${value ? ` ${value}` : ""}`;
  const front = [
    "---",
    `done: ${meta.done ? "true" : "false"}`,
    line("created_at", meta.createdAt),
    line("done_at", meta.doneAt),
    "---",
  ].join("\n");
  return body ? `${front}\n\n${body}\n` : `${front}\n`;
}

// ── Plan entry + sections ────────────────────────────────────────────────

/** A plan as the server hands it to the client. */
export interface Plan {
  /** Path relative to the plans root, "/"-separated. */
  path: string;
  title: string;
  anchor: PlanAnchor;
  done: boolean;
  createdAt: string | null;
  doneAt: string | null;
  note: string;
  /** ISO mtime, used later for write conflict detection. */
  mtime: string;
}

/** A file that could not be read as a plan; shown in 待整理, never rewritten. */
export interface UnsortedPlan {
  path: string;
  problems: PlanProblem[];
}

export type PlanSectionId = "inbox" | "overdue" | "today" | "upcoming";

/** Section order the panel renders, top to bottom. */
export const PLAN_SECTION_IDS: readonly PlanSectionId[] = [
  "inbox",
  "overdue",
  "today",
  "upcoming",
];

export interface PlanSection {
  id: PlanSectionId;
  plans: Plan[];
}

/** Which section a plan belongs to. Sections are decided by the anchor alone,
 *  so a plan never shows up in two of them. */
export function planSectionOf(plan: Plan, today: string): PlanSectionId {
  if (plan.anchor.kind === "inbox") return "inbox";
  if (plan.anchor.date === today) return "today";
  return plan.anchor.date < today ? "overdue" : "upcoming";
}

/** Anchor time first, then created_at, then path — never drag order. */
function comparePlans(a: Plan, b: Plan): number {
  const keyA = [a.anchor.kind === "inbox" ? "" : a.anchor.date, a.createdAt ?? "", a.path];
  const keyB = [b.anchor.kind === "inbox" ? "" : b.anchor.date, b.createdAt ?? "", b.path];
  for (let i = 0; i < keyA.length; i += 1) {
    if (keyA[i] !== keyB[i]) return keyA[i] < keyB[i] ? -1 : 1;
  }
  return 0;
}

/** Partition plans into the ordered sections, each sorted. Every section is
 *  present even when empty, so the client renders a stable shape. */
export function groupPlans(plans: readonly Plan[], today: string): PlanSection[] {
  const buckets = new Map<PlanSectionId, Plan[]>(
    PLAN_SECTION_IDS.map((id) => [id, []]),
  );
  for (const plan of plans) buckets.get(planSectionOf(plan, today))!.push(plan);
  return PLAN_SECTION_IDS.map((id) => ({ id, plans: buckets.get(id)!.sort(comparePlans) }));
}

// ── HTTP payload ─────────────────────────────────────────────────────────

export interface PlansResponse {
  /** The local date key the sections were computed against. */
  today: string;
  sections: PlanSection[];
  unsorted: UnsortedPlan[];
}
