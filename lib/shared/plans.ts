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
//   YYYY-MM/YYYY-MM-DDW-<title>.md       week anchor (date = that week's Monday)
//   YYYY-MM/YYYY-MM-M-<title>.md         month anchor
//
// The anchor is the single source of truth and lives in the *path*; the
// frontmatter carries only `done` / `created_at` / `done_at`.
//
// A calendar week runs Monday–Sunday. A week that straddles a month boundary
// belongs to the month its *Monday* falls in, and the path names that Monday
// (never "week N"), so the file also says which month it was filed under.

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

/** True for a real calendar month in `YYYY-MM` form (rejects 2026-13, 2026-9). */
export function isMonthKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function toLocalDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** `dateKey` shifted by `delta` days, keeping the local calendar. */
export function addDays(dateKey: string, delta: number): string {
  const date = toLocalDate(dateKey);
  date.setDate(date.getDate() + delta);
  return toDateKey(date);
}

/**
 * Date key of the Monday starting the calendar week a date belongs to
 * (weeks run Monday–Sunday, ISO-style). `weekEndOf(dateKey)` is the Sunday.
 */
export function weekStartOf(dateKey: string): string {
  const date = toLocalDate(dateKey);
  const offset = (date.getDay() + 6) % 7; // Sunday = 0 → 6, Monday = 1 → 0
  return addDays(dateKey, -offset);
}

/** Date key of the Sunday ending the calendar week a date belongs to. */
export function weekEndOf(dateKey: string): string {
  return addDays(weekStartOf(dateKey), 6);
}

/** True when a real date key is a Monday — what a week anchor is named by. */
export function isMonday(dateKey: string): boolean {
  return isDateKey(dateKey) && weekStartOf(dateKey) === dateKey;
}

/** Compact `M/D` for a date key (`2026-09-28` → `9/28`), for week ranges and
 *  the mini calendar's day cells. */
export function shortDateKey(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** Last day of a `YYYY-MM` month, as a date key (2024-02 → 2024-02-29). */
export function monthEndOf(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const last = new Date(year, month, 0).getDate(); // day 0 of the next month
  return `${monthKey}-${String(last).padStart(2, "0")}`;
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
  | { kind: "day"; date: string }
  | { kind: "week"; date: string }
  | { kind: "month"; month: string };

export type PlanAnchorKind = PlanAnchor["kind"];

/**
 * Parse an anchor out of untrusted input (a request body). Returns `null`
 * for anything that is not a real inbox / day / week / month anchor — in
 * particular a date carrying path syntax, which is what keeps a
 * client-supplied anchor from steering the write outside the plans root.
 * A week anchor must name a Monday, which is the day its path is built from.
 */
export function parsePlanAnchor(value: unknown): PlanAnchor | null {
  if (typeof value !== "object" || value === null) return null;
  const anchor = value as { kind?: unknown; date?: unknown; month?: unknown };
  if (anchor.kind === "inbox") return { kind: "inbox" };
  if (anchor.kind === "day" && typeof anchor.date === "string" && isDateKey(anchor.date)) {
    return { kind: "day", date: anchor.date };
  }
  if (anchor.kind === "week" && typeof anchor.date === "string" && isMonday(anchor.date)) {
    return { kind: "week", date: anchor.date };
  }
  if (anchor.kind === "month" && typeof anchor.month === "string" && isMonthKey(anchor.month)) {
    return { kind: "month", month: anchor.month };
  }
  return null;
}

// ── Anchor↔time helpers ──────────────────────────────────────────────────
// The anchor's *end* decides overdue; its *start* orders it. Both are plain
// date keys so the rest of the module compares strings.

/** True when two anchors point at the same point in time — what tells a real
 *  re-schedule from a PATCH that merely restates the anchor already on the
 *  file. The inverse of `planAnchorsEqual` is what renames the file. */
export function planAnchorsEqual(a: PlanAnchor, b: PlanAnchor): boolean {
  switch (a.kind) {
    case "inbox":
      return b.kind === "inbox";
    case "day":
    case "week":
      return a.kind === b.kind && a.date === b.date;
    case "month":
      return b.kind === "month" && a.month === b.month;
  }
}

/** First day the anchor covers: the day itself, the Monday, or the 1st.
 *  The inbox has no time, so it sorts (and reads) as the empty key. */
export function anchorStartKey(anchor: PlanAnchor): string {
  switch (anchor.kind) {
    case "inbox":
      return "";
    case "day":
    case "week":
      return anchor.date;
    case "month":
      return `${anchor.month}-01`;
  }
}

/** Last day the anchor covers — what "overdue" compares against. `null` for
 *  the inbox, which never expires. */
export function anchorEndKey(anchor: PlanAnchor): string | null {
  switch (anchor.kind) {
    case "inbox":
      return null;
    case "day":
      return anchor.date;
    case "week":
      return weekEndOf(anchor.date);
    case "month":
      return monthEndOf(anchor.month);
  }
}

/** The create input's one-tap anchor choices. `today` is the caller's local
 *  date key; "tomorrow", "week" and "month" are derived from it here so the
 *  client never does calendar arithmetic of its own. */
export type PlanAnchorChoice = "inbox" | "today" | "tomorrow" | "week" | "month";

export function anchorForChoice(choice: PlanAnchorChoice, today: string): PlanAnchor {
  switch (choice) {
    case "inbox":
      return { kind: "inbox" };
    case "today":
      return { kind: "day", date: today };
    case "tomorrow":
      return { kind: "day", date: addDays(today, 1) };
    case "week":
      return { kind: "week", date: weekStartOf(today) };
    case "month":
      return { kind: "month", month: monthKeyOf(today) };
  }
}

/**
 * The one-tap choice an anchor currently *is*, or `null` when no chip names it
 * (a day far in the future, say). The row uses this to mark the chip the plan
 * already sits on, so clicking it cannot silently re-write the file.
 */
export function anchorChoiceOf(anchor: PlanAnchor, today: string): PlanAnchorChoice | null {
  switch (anchor.kind) {
    case "inbox":
      return "inbox";
    case "day":
      if (anchor.date === today) return "today";
      return anchor.date === addDays(today, 1) ? "tomorrow" : null;
    case "week":
      return anchor.date === weekStartOf(today) ? "week" : null;
    case "month":
      return anchor.month === monthKeyOf(today) ? "month" : null;
  }
}

// ── Mini month calendar ──────────────────────────────────────────────────
// The panel's resident calendar is a *projection* of the list it is already
// showing: the grid comes from the calendar rules here, and the badges are
// counted from the loaded plans — the calendar asks the server for nothing of
// its own.

/** One row of the mini month calendar: a Monday-first week plus the month the
 *  week is filed under (its Monday's month, ADR-0006). */
export interface PlanCalendarWeek {
  /** Monday starting the week — the date a week anchor is named by. */
  start: string;
  /** Seven date keys, Monday → Sunday. */
  days: string[];
  /** Month the week belongs to: the Monday's month, which is also its filing
   *  directory — the reason a cross-month week has to say so. */
  month: string;
}

/** Month key shifted by whole months (`2026-01` − 1 → `2025-12`). */
export function addMonths(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(year, month - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The rows a month's mini calendar shows: every Monday-first week that holds
 * at least one day of the month, plus the neighbouring months' days that fill
 * the first and last rows. 4–6 rows for a real month.
 */
export function monthCalendarWeeks(monthKey: string): PlanCalendarWeek[] {
  const last = monthEndOf(monthKey);
  const weeks: PlanCalendarWeek[] = [];
  for (let start = weekStartOf(`${monthKey}-01`); start <= last; start = addDays(start, 7)) {
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    weeks.push({ start, days, month: monthKeyOf(start) });
  }
  return weeks;
}

/** True when the week has days in two months, so the row must name the month
 *  that owns it (the Monday's — not the month it ends in). */
export function isCrossMonthWeek(week: PlanCalendarWeek): boolean {
  return monthKeyOf(week.days[6]) !== week.month;
}

/** Counts of loaded plans per period, for the calendar's badges. A day anchor
 *  counts on its date, a week anchor on its Monday, a month anchor on its
 *  month; the inbox has no time and never appears on the calendar. */
export interface PlanCounts {
  days: ReadonlyMap<string, number>;
  weeks: ReadonlyMap<string, number>;
  months: ReadonlyMap<string, number>;
}

export function countPlans(plans: readonly Plan[]): PlanCounts {
  const days = new Map<string, number>();
  const weeks = new Map<string, number>();
  const months = new Map<string, number>();
  const bump = (counts: Map<string, number>, key: string) =>
    counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const plan of plans) {
    switch (plan.anchor.kind) {
      case "day":
        bump(days, plan.anchor.date);
        break;
      case "week":
        bump(weeks, plan.anchor.date);
        break;
      case "month":
        bump(months, plan.anchor.month);
        break;
      case "inbox":
        break;
    }
  }
  return { days, weeks, months };
}

// ── Parse problems (the 待整理 feed) ──────────────────────────────────────
// A problem is a machine-readable code plus the offending fragment; the panel
// turns a code into a translated sentence (full 待整理 UI lands in a later
// slice). Parsing never throws and never rewrites the file.

export type PlanProblemCode =
  | "name-syntax"
  | "date-invalid"
  | "week-not-monday"
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
const WEEK_FILE_RE = /^(\d{4}-\d{2}-\d{2})W-(.+)$/;
const MONTH_FILE_RE = /^(\d{4}-\d{2})-M-(.+)$/;

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

  // The `W` / `M` markers are what keep the three prefixes unambiguous: a
  // day file is the only one with a bare `YYYY-MM-DD-` before the title.
  const week = WEEK_FILE_RE.exec(stem);
  if (week) {
    const date = week[1];
    const title = week[2];
    if (!isDateKey(date)) return parseFailure("date-invalid", date);
    if (!isMonday(date)) return parseFailure("week-not-monday", date);
    if (monthKeyOf(date) !== dir) {
      return parseFailure("month-mismatch", `${dir} ≠ ${monthKeyOf(date)}`);
    }
    if (!title.trim()) return parseFailure("name-syntax", fileName);
    return { ok: true, anchor: { kind: "week", date }, title };
  }

  const month = MONTH_FILE_RE.exec(stem);
  if (month) {
    const key = month[1];
    const title = month[2];
    if (!isMonthKey(key)) return parseFailure("date-invalid", key);
    if (key !== dir) return parseFailure("month-mismatch", `${dir} ≠ ${key}`);
    if (!title.trim()) return parseFailure("name-syntax", fileName);
    return { ok: true, anchor: { kind: "month", month: key }, title };
  }

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

/** Directory (relative to the plans root) holding every plan of an anchor.
 *  That is the anchor's *month* — for a cross-month week, the month its
 *  Monday falls in (9/29–10/5 is filed under 9). */
export function planDirOf(anchor: PlanAnchor): string {
  switch (anchor.kind) {
    case "inbox":
      return "inbox";
    case "month":
      return anchor.month;
    default:
      return monthKeyOf(anchor.date);
  }
}

/** Filename prefix that encodes the anchor (`""`, `2026-09-15-`,
 *  `2026-09-29W-`, `2026-09-M-`). */
function planFilePrefix(anchor: PlanAnchor): string {
  switch (anchor.kind) {
    case "inbox":
      return "";
    case "day":
      return `${anchor.date}-`;
    case "week":
      return `${anchor.date}W-`;
    case "month":
      return `${anchor.month}-M-`;
  }
}

/** Plan-relative path for a plan, i.e. the inverse of `parsePlanPath`. */
export function planRelativePath(anchor: PlanAnchor, title: string): string {
  return `${planDirOf(anchor)}/${planFileName(anchor, title)}`;
}

/**
 * Path a plan moves to when its anchor changes.
 *
 * The title goes in **verbatim**: it came out of a filename that already
 * passed the contract, so re-sanitizing it could silently change what the plan
 * is called. No `-2` de-duplication either — a target that is already taken is
 * an error the user has to answer, not a rename behind their back (see
 * `updatePlanFile`).
 */
export function movedPlanRelativePath(anchor: PlanAnchor, title: string): string {
  return `${planDirOf(anchor)}/${planFilePrefix(anchor)}${title}.md`;
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
  const prefix = planFilePrefix(anchor);
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
  /** Absolute path on disk — what the row's "copy path" hands to external tools. */
  absPath: string;
  title: string;
  anchor: PlanAnchor;
  done: boolean;
  createdAt: string | null;
  doneAt: string | null;
  note: string;
  /** ISO mtime; the write guard compares it to the file's current mtime. */
  mtime: string;
}

/**
 * One-line, greyed-out reminder of a note, shown in the list while the note
 * is collapsed: the first non-empty line with runs of whitespace collapsed.
 * Empty when the note is empty (or whitespace only).
 */
export function noteSummary(note: string): string {
  for (const line of note.split(/\r?\n/)) {
    const text = line.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

/** A file that could not be read as a plan; shown in 待整理, never rewritten. */
export interface UnsortedPlan {
  /** Path relative to the plans root, "/"-separated. */
  path: string;
  /** Absolute path on disk — the 待整理 row's "copy path" hands it to an
   *  external editor, which is where the fix belongs. */
  absPath: string;
  /** Every reason the file is not a plan, in the order the parser found them. */
  problems: PlanProblem[];
}

export type PlanSectionId = "inbox" | "overdue" | "today" | "week" | "month" | "upcoming";

/** Section order the panel renders, top to bottom. */
export const PLAN_SECTION_IDS: readonly PlanSectionId[] = [
  "inbox",
  "overdue",
  "today",
  "week",
  "month",
  "upcoming",
];

export interface PlanSection {
  id: PlanSectionId;
  plans: Plan[];
}

/**
 * Which section a plan belongs to. A section is decided by the anchor's
 * *granularity* plus where "today" falls: only a day anchor can be `today`,
 * only a week anchor can be `week`, only a month anchor can be `month` — so a
 * plan is assigned exactly once and never shows up in two sections.
 *
 * Overdue compares the anchor's *end* (day = that day, week = Sunday,
 * month = the month's last day) against today, so a plan whose anchor has not
 * finished yet is never overdue.
 */
export function planSectionOf(plan: Plan, today: string): PlanSectionId {
  const { anchor } = plan;
  if (anchor.kind === "inbox") return "inbox";
  const end = anchorEndKey(anchor)!;
  if (end < today) return "overdue";
  switch (anchor.kind) {
    case "day":
      return anchor.date === today ? "today" : "upcoming";
    case "week":
      return today >= anchor.date && today <= end ? "week" : "upcoming";
    case "month":
      return monthKeyOf(today) === anchor.month ? "month" : "upcoming";
  }
}

/** Anchor start first, then created_at, then path — never drag order. */
function comparePlans(a: Plan, b: Plan): number {
  return compareKeys(
    [anchorStartKey(a.anchor), a.createdAt ?? "", a.path],
    [anchorStartKey(b.anchor), b.createdAt ?? "", b.path],
  );
}

/** Lexicographic compare of two equal-length key tuples — the one place the
 *  sections and the timeline share their tie-break rule. */
function compareKeys(keyA: readonly string[], keyB: readonly string[]): number {
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

/**
 * The inverse of `groupPlans`: every plan a section list holds, in section
 * order. The panel needs a flat view in three places (the total count, the
 * mini calendar's badges, looking a plan up by path), and "walk the sections
 * and flatten" is not a rule worth spelling out more than once.
 */
export function flattenPlanSections(sections: readonly PlanSection[]): Plan[] {
  return sections.flatMap((section) => section.plans);
}

/**
 * Apply the panel's 「隐藏已完成」switch. Completed plans are records, not noise
 * to be deleted, so hiding them only drops them from the sections — the files
 * stay put and the switch is non-destructive.
 */
export function hideCompletedPlans(
  sections: readonly PlanSection[],
  hide: boolean,
): PlanSection[] {
  if (!hide) return [...sections];
  return sections.map((section) => ({
    ...section,
    plans: section.plans.filter((plan) => !plan.done),
  }));
}

// ── HTTP payload ─────────────────────────────────────────────────────────

export interface PlansResponse {
  /** The local date key the sections were computed against. */
  today: string;
  sections: PlanSection[];
  unsorted: UnsortedPlan[];
}

/** Why the server refused a plan write (the API answers 409 for all three).
 *  Shared so the route, the store and the client cannot drift apart:
 *  `modified` / `missing` are resolved by 「覆盖 / 重载」，`name-taken` is not. */
export type PlanConflictCode = "modified" | "missing" | "name-taken";
