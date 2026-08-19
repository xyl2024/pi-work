"use client";

import type { Tag, Todo, Priority } from "@/hooks/useTodos";
import type { Filters, StatusFilter, DeadlineFilter, DeadlineTone } from "./types";

// Persists the user's filter preference across tab close/reopen and page reload.
// Follows the i18n hydration pattern (hooks/useI18n.tsx) — lazy default + useEffect read.
export const TODO_FILTERS_STORAGE_KEY = "pi-todo-filters";

export const DEFAULT_FILTERS: Filters = {
  status: "all",
  deadline: "all",
  dateRange: { from: null, to: null },
  tags: [],
  priorityFilters: [],
};

export const STATUS_FILTER_OPTIONS: { key: StatusFilter; labelKey: string }[] = [
  { key: "all", labelKey: "All" },
  { key: "active", labelKey: "InProgress" },
  { key: "done", labelKey: "Done" },
];

export const DEADLINE_FILTER_OPTIONS: { key: DeadlineFilter; labelKey: string }[] = [
  { key: "all", labelKey: "All" },
  { key: "overdue", labelKey: "Overdue" },
  { key: "today", labelKey: "Due today" },
  { key: "thisWeek", labelKey: "This week" },
  { key: "thisMonth", labelKey: "This month" },
  { key: "noDeadline", labelKey: "No deadline" },
];

const STATUS_VALUES: ReadonlySet<StatusFilter> = new Set(["all", "active", "done"]);
const DEADLINE_VALUES: ReadonlySet<DeadlineFilter> = new Set([
  "all",
  "overdue",
  "today",
  "thisWeek",
  "thisMonth",
  "noDeadline",
]);
const PRIORITY_FILTER_VALUES: ReadonlySet<Priority | "none"> = new Set<Priority | "none">([
  "high",
  "medium",
  "low",
  "none",
]);

// Higher rank = closer to the top of the list. Mirrors `priorityRank` in
// lib/todo-store.ts (server-side sort) — kept in sync by hand. `undefined`
// (DB NULL / never set) ranks last so users always see the things they
// actually marked first.
export function priorityRank(p: Priority | undefined): number {
  switch (p) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

// Comparator used by the todo list and the month calendar. Active todos
// always sort ahead of completed ones (the "now vs. archive" split);
// inside each bucket, priority desc → createdAt desc.
export function sortByPriorityThenCreatedAt(todos: Todo[], activeFirst: boolean): Todo[] {
  return [...todos].sort((a, b) => {
    if (activeFirst && a.done !== b.done) return a.done ? 1 : -1;
    const ap = priorityRank(a.priority);
    const bp = priorityRank(b.priority);
    if (ap !== bp) return bp - ap;
    return b.createdAt - a.createdAt;
  });
}

/**
 * Read and validate a persisted Filters object from localStorage. Falls back to
 * DEFAULT_FILTERS for any field that doesn't match the expected shape so a
 * corrupt or stale entry can never crash the panel. Any `sort` field carried
 * over from a pre-priority release is silently dropped — the new sort order
 * (priority → createdAt) is hardcoded and not user-toggleable.
 */
export function parsePersistedFilters(raw: string | null): Filters {
  if (!raw) return DEFAULT_FILTERS;
  try {
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return DEFAULT_FILTERS;
    const o = obj as Record<string, unknown>;
    const status = STATUS_VALUES.has(o.status as StatusFilter)
      ? (o.status as StatusFilter)
      : DEFAULT_FILTERS.status;
    const deadline = DEADLINE_VALUES.has(o.deadline as DeadlineFilter)
      ? (o.deadline as DeadlineFilter)
      : DEFAULT_FILTERS.deadline;
    const drRaw = o.dateRange as { from?: unknown; to?: unknown } | null;
    const dr = drRaw && typeof drRaw === "object" ? drRaw : null;
    const from = dr && (typeof dr.from === "number" || dr.from === null) ? (dr.from as number | null) : null;
    const to = dr && (typeof dr.to === "number" || dr.to === null) ? (dr.to as number | null) : null;
    const tags = Array.isArray(o.tags) && o.tags.every((t) => typeof t === "string")
      ? (o.tags as string[])
      : [];
    const pfRaw = o.priorityFilters;
    const priorityFilters: (Priority | "none")[] =
      Array.isArray(pfRaw) &&
      pfRaw.every((v): v is Priority | "none" => typeof v === "string" && PRIORITY_FILTER_VALUES.has(v as Priority | "none"))
        ? (pfRaw as (Priority | "none")[])
        : DEFAULT_FILTERS.priorityFilters;
    return { status, deadline, dateRange: { from, to }, tags, priorityFilters };
  } catch {
    return DEFAULT_FILTERS;
  }
}

// Mirrors lib/todo-store.ts MAX_TAG_LENGTH. Kept in sync by hand; the server is
// the source of truth and rejects anything longer.
export const MAX_TAG_LENGTH = 50;

/**
 * Aggregate every tag used across the visible todos, deduped case-insensitively
 * (preserving first-seen casing + color) and sorted case-insensitively. Used to
 * power the autocomplete suggestions inside the edit-tags modal and the
 * filter popover.
 */
export function aggregateTags(todos: Todo[]): Tag[] {
  const seen = new Map<string, Tag>();
  for (const t of todos) {
    for (const tag of t.tags) {
      const key = tag.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.set(key, tag);
    }
  }
  const out = [...seen.values()];
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

/**
 * Detect the in-progress `#xxx` token sitting at the cursor. Returns null when
 * the cursor isn't inside a tag trigger (e.g. cursor sits after a space, or no
 * `#` has been typed yet). Used to decide whether the TagPickerPopover should
 * be shown.
 */
export function detectActiveTagToken(
  value: string,
  cursor: number,
): { start: number; end: number; query: string } | null {
  if (cursor < 1) return null;
  const upTo = value.slice(0, cursor);
  const hashIdx = upTo.lastIndexOf("#", cursor - 1);
  if (hashIdx < 0) return null;
  // Must be at start of input or preceded by whitespace — a `#` inside a word
  // (e.g. "issue#42") is plain text, not a tag trigger.
  if (hashIdx > 0 && !/\s/.test(value.charAt(hashIdx - 1))) return null;
  const after = value.slice(hashIdx + 1, cursor);
  if (/\s/.test(after)) return null;
  return { start: hashIdx, end: cursor, query: after };
}

/**
 * Split raw input into a clean title and a list of tags. Whitespace-separated
 * tokens beginning with `#` (and longer than one character) become tags; the
 * rest becomes the title. Case-insensitive dedupe, first-seen casing kept —
 * matches the server's normalizeTags() in lib/todo-store.ts.
 */
export function parseCreateInput(value: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  const titleTokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith("#") && raw.length > 1) {
      const tag = raw.slice(1).trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    } else {
      titleTokens.push(raw);
    }
  }
  return { title: titleTokens.join(" ").trim(), tags };
}

// Block-level tags that should add line breaks around their content. Mirrors
// what users see as separate blocks in TodoDescriptionView's markdown-body
// styling — paragraphs, headings, list items, preformatted blocks, tables.
export const PLAIN_TEXT_BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "pre", "blockquote", "hr", "tr",
  "section", "article", "header", "footer", "aside",
]);

/**
 * Convert a todo description's HTML into clean plain text for clipboard copy.
 *
 * - Drops `<img>` (and any other non-text resource) entirely — the requirement
 *   is to copy text only, not other resources.
 * - Inserts a single `\n` around block-level elements so paragraphs, list
 *   items, and headings stay visually separated.
 * - Collapses runs of spaces/tabs into one, and 3+ newlines into one blank
 *   line — removes the "useless empty lines and spaces" the user called out.
 * - Preserves real newlines inside `<pre>` blocks (textContent already keeps
 *   them as `\n` characters in the source string).
 */
export function descriptionToPlainText(html: string): string {
  if (!html || typeof document === "undefined") return "";
  // Strip <img> up front so any alt text can't leak through. Other resource
  // tags (iframe, video, audio) carry no text either and are handled by the
  // walker's element-type check.
  const stripped = html.replace(/<img\b[^>]*\/?>/gi, "");
  const container = document.createElement("div");
  container.innerHTML = stripped;

  const parts: string[] = [];

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "img") return;

    const isBlock = PLAIN_TEXT_BLOCK_TAGS.has(tag);
    if (isBlock && parts.length > 0) {
      // Trim trailing spaces/tabs on the previous part before adding the
      // block's leading newline so we don't end up with "  \n".
      const last = parts[parts.length - 1];
      parts[parts.length - 1] = last.replace(/[ \t]+$/, "");
      parts.push("\n");
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }

    if (isBlock) parts.push("\n");
  };

  walk(container);

  return parts.join("")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Copy a todo description as rich text — HTML on the clipboard alongside a
 * plain-text fallback so pasting into another app preserves color spans,
 * bold/italic, lists, etc.
 *
 * The stored HTML was sanitized at save time, so we trust it as-is. The
 * fallback to `writeText` covers browsers / contexts where `ClipboardItem`
 * isn't available (older Safari, non-secure origin).
 */
export async function copyDescriptionAsRichText(html: string): Promise<void> {
  const plainText = descriptionToPlainText(html);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
    return;
  }
  await navigator.clipboard.writeText(plainText);
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfNextDay(ts: number): number {
  const date = new Date(startOfDay(ts));
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function formatDeadline(deadline: number, now: number = Date.now()): { label: string; tone: DeadlineTone; daysAhead: number } {
  const todayStart = startOfDay(now);
  const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;
  const d = new Date(deadline);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const label = `${m}-${day}`;
  if (deadline < todayStart) return { label, tone: "overdue", daysAhead: 0 };
  if (deadline <= todayEnd) return { label, tone: "today", daysAhead: 0 };
  const daysAhead = Math.round((startOfDay(deadline) - todayStart) / (24 * 60 * 60 * 1000));
  return { label, tone: "future", daysAhead };
}

// Truncate a tag name for display in the (narrow) popover rows. The full
// string is still passed to the server; a `title=` attribute shows the
// complete value on hover.
export function truncateTag(s: string, n = 24): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Tool keys exposed to the pi agent for the todo store.
export const TOOL_KEYS = ["user_todos_list", "user_todo_description"] as const;