"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTodos, type Tag } from "@/hooks/useTodos";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { FilterBar } from "./FilterBar";
import { TodoItem } from "./TodoItem";
import { TodoMonthCalendar, type CalendarMonth } from "./TodoMonthCalendar";
import {
  DEFAULT_FILTERS,
  TODO_FILTERS_STORAGE_KEY,
  aggregateTags,
  parsePersistedFilters,
  sortByPriorityThenCreatedAt,
  startOfDay,
  startOfNextDay,
} from "./utils";
import type { Filters } from "./types";

export function TodoPanel() {
  const { t, locale } = useI18n();
  const { todos, loading, refresh, addTodo, updateTodo, deleteTodo, toggleDone, exportTodo, renameTag, deleteTag, setTagColor } = useTodos();
  const confirm = useConfirm();
  const toast = useToast();
  const [viewFilters, setViewFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [calendarSelectedDay, setCalendarSelectedDay] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<CalendarMonth>(() => {
    const date = new Date();
    return { year: date.getFullYear(), month: date.getMonth() };
  });

  // Hydrate persisted filter preference after mount (SSR-safe: defaults above
  // match what the server renders, then we sync from localStorage).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TODO_FILTERS_STORAGE_KEY);
      setViewFilters(parsePersistedFilters(raw));
    } catch {
      // localStorage unavailable — keep defaults.
    }
  }, []);

  // Single entry point for user-initiated filter changes: updates the view
  // and writes to localStorage. The transient add-flow handlers call
  // setViewFilters directly so they don't overwrite the saved preference.
  const applyFiltersChange = useCallback((next: Filters) => {
    setViewFilters(next);
    try {
      localStorage.setItem(TODO_FILTERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable — in-memory state is still updated.
    }
  }, []);

  const handleFiltersChange = useCallback((next: Filters) => {
    setCalendarSelectedDay(null);
    applyFiltersChange(next);
  }, [applyFiltersChange]);

  const filterActive = viewFilters.status !== "all" || viewFilters.deadline !== "all" || viewFilters.dateRange.from != null || viewFilters.dateRange.to != null || viewFilters.tags.length > 0 || viewFilters.priorityFilters.length > 0;

  const [now] = useState(() => Date.now());
  const startOfToday = startOfDay(now);
  const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000;
  // "本周内" = 本周一 ~ 本周日（含今天）。endOfThisWeek 取"下周一 0 点"，
  // 即本周日结束那一刻。使用 ISO 8601：周一为 1，周日为 0。
  const dayOfWeek = new Date(now).getDay();
  const daysToEndOfWeek = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const endOfThisWeek = startOfToday + daysToEndOfWeek * 24 * 60 * 60 * 1000;
  // "本月内" = 本月 1 日 0 点 ~ 下月 1 日 0 点（不含）。
  const nowDate = new Date(now);
  const startOfThisMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1, 0, 0, 0, 0).getTime();
  const endOfThisMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1, 0, 0, 0, 0).getTime();

  const tagSuggestions = useMemo(() => aggregateTags(todos), [todos]);

  // Per-tag usage count, deduped case-insensitively. Powers the count column
  // in the tag manager popover. Each todo contributes at most one to any
  // given key, which is a defense-in-depth check on top of normalizeTags.
  const tagCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const todo of todos) {
      const seen = new Set<string>();
      for (const tag of todo.tags) {
        const key = tag.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        map[key] = (map[key] ?? 0) + 1;
      }
    }
    return map;
  }, [todos]);

  const visible = useMemo(() => {
    // The list is always sorted by priority desc -> createdAt desc, with
    // active todos always above completed ones (when the user hasn't
    // already filtered down to one bucket). The priority filter is
    // applied here, before sorting, so set-based membership checks stay
    // cheap.
    const wantedTags = viewFilters.tags.length > 0
      ? new Set(viewFilters.tags.map((t) => t.toLowerCase()))
      : null;
    const pf = viewFilters.priorityFilters;
    const priorityWanted = pf.length > 0 ? new Set(pf) : null;
    const filtered = [...todos]
      .filter((x) => {
        if (viewFilters.status === "active" && x.done) return false;
        if (viewFilters.status === "done" && !x.done) return false;
        switch (viewFilters.deadline) {
          case "all":
            break;
          case "overdue":
            if (x.done || x.deadline === undefined || x.deadline >= startOfToday) return false;
            break;
          case "today":
            if (x.done || x.deadline === undefined || x.deadline < startOfToday || x.deadline >= startOfTomorrow) return false;
            break;
          case "thisWeek":
            if (x.done || x.deadline === undefined || x.deadline < startOfToday || x.deadline >= endOfThisWeek) return false;
            break;
          case "thisMonth":
            if (x.done || x.deadline === undefined || x.deadline < startOfThisMonth || x.deadline >= endOfThisMonth) return false;
            break;
          case "noDeadline":
            if (x.deadline !== undefined) return false;
            break;
        }
        return true;
      })
      .filter((x) => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return true;
        return x.title.toLowerCase().includes(term) ||
          (x.description ?? "").toLowerCase().includes(term);
      })
      .filter((x) => {
        if (viewFilters.dateRange.from == null && viewFilters.dateRange.to == null) return true;
        if (x.deadline == null) return false;
        if (viewFilters.dateRange.from != null && x.deadline < viewFilters.dateRange.from) return false;
        if (viewFilters.dateRange.to != null && x.deadline > viewFilters.dateRange.to) return false;
        return true;
      })
      .filter((x) => {
        if (!wantedTags) return true;
        return x.tags.some((t) => wantedTags.has(t.name.toLowerCase()));
      })
      .filter((x) => {
        if (!priorityWanted) return true;
        const key = x.priority ?? "none";
        return priorityWanted.has(key);
      });
    return sortByPriorityThenCreatedAt(filtered, viewFilters.status === "all");
  }, [todos, viewFilters, searchTerm, startOfToday, startOfTomorrow, endOfThisWeek, startOfThisMonth, endOfThisMonth]);

  // The month calendar projects every todo onto a day grid; per-day
  // ordering follows the same priority-then-createdAt rule so a high-
  // priority todo always sits above a medium-priority one when both
  // fall on the same date.
  const calendarTodos = useMemo(
    () => sortByPriorityThenCreatedAt(todos, true),
    [todos],
  );
  const displayedTodos = useMemo(() => {
    if (calendarSelectedDay == null) return visible;
    const dayEnd = startOfNextDay(calendarSelectedDay);
    return calendarTodos.filter((todo) => todo.deadline != null && todo.deadline >= calendarSelectedDay && todo.deadline < dayEnd);
  }, [calendarSelectedDay, calendarTodos, visible]);

  const handleCalendarSelectDay = useCallback((ts: number) => {
    const dayEnd = startOfNextDay(ts);
    const hasTodos = todos.some((todo) => todo.deadline != null && todo.deadline >= ts && todo.deadline < dayEnd);
    if (!hasTodos) return;
    if (calendarSelectedDay === ts) {
      setCalendarSelectedDay(null);
      return;
    }
    applyFiltersChange({ ...DEFAULT_FILTERS });
    setSearchTerm("");
    setCalendarSelectedDay(ts);
  }, [applyFiltersChange, calendarSelectedDay, todos]);

  const handleSearchChange = useCallback((value: string) => {
    setCalendarSelectedDay(null);
    setSearchTerm(value);
  }, []);

  const handleCreate = async (input: { title: string; tags?: string[] }): Promise<boolean> => {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) return false;
    // Resolve tag names (string[]) to Tag[] using the current suggestions so
    // a typed `#work` inherits the global color of an existing tag "work".
    const tags: Tag[] | undefined = input.tags?.map((name) => {
      const existing = tagSuggestions.find((s) => s.name.toLowerCase() === name.toLowerCase());
      return { name, color: existing?.color };
    });
    const todo = await addTodo(trimmed, { tags });
    if (todo) {
      // Make the new todo visible — matches the legacy DraftRow flow. Also
      // clear the deadline preset since new todos default to today and would
      // otherwise be hidden by filters like "No deadline" or "Overdue".
      setViewFilters((f) => ({ ...f, status: "active", deadline: "all" }));
      return true;
    }
    return false;
  };

  const handleDelete = async (todo: { id: string; title: string }) => {
    const ok = await confirm({
      title: t("Delete todo?"),
      description: todo.title,
      confirmLabel: t("Delete"),
      destructive: true,
    });
    if (ok) deleteTodo(todo.id);
  };

  // Tag-level handlers. The server returns { tag, affected } and we refresh
  // the local list there; here we just surface the success toast and (for
  // delete) scrub the tag out of the active filter so it doesn't silently
  // become a no-op filter.
  const handleSetTagColor = async (tag: string, color: string | null) => {
    await setTagColor(tag, color);
    // Success/error toast is surfaced by the context method itself; no further
    // UI scrub needed since the refresh() inside setTagColor pulls the new
    // color into every chip.
  };

  const handleRenameTag = async (from: string, to: string) => {
    const result = await renameTag(from, to);
    if (result) {
      toast.show({ kind: "success", message: t("Tag renamed") });
      // If `from` was in the active filter, swap the entry so the filtered
      // list stays consistent. Comparison is case-insensitive, matching
      // listTodos and the client filter eval.
      if (viewFilters.tags.some((x) => x.toLowerCase() === from.toLowerCase())) {
        const nextTags = viewFilters.tags.map((x) =>
          x.toLowerCase() === from.toLowerCase() ? result.tag : x
        );
        applyFiltersChange({ ...viewFilters, tags: nextTags });
      }
    }
  };

  const handleDeleteTag = async (tag: string) => {
    const result = await deleteTag(tag);
    if (result) {
      toast.show({ kind: "success", message: t("Tag deleted") });
      // Drop the deleted tag from the active filter (case-insensitive match)
      // so the filter doesn't silently become empty.
      const lower = tag.toLowerCase();
      if (viewFilters.tags.some((x) => x.toLowerCase() === lower)) {
        applyFiltersChange({
          ...viewFilters,
          tags: viewFilters.tags.filter((x) => x.toLowerCase() !== lower),
        });
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <FilterBar
        filters={viewFilters}
        onFiltersChange={handleFiltersChange}
        filterOpen={filterOpen}
        onFilterOpenChange={setFilterOpen}
        filterActive={filterActive}
        onCreate={handleCreate}
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
        tagSuggestions={tagSuggestions}
        tagCounts={tagCounts}
        onRenameTag={handleRenameTag}
        onDeleteTag={handleDeleteTag}
        onSetTagColor={handleSetTagColor}
        onRefresh={refresh}
        refreshing={loading}
      />
      <div data-scroll-wide style={{ flex: 2, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
        {loading && todos.length === 0 && (
          <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            {t("Loading...")}
          </div>
        )}
        {!loading && displayedTodos.length === 0 && (
          <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
            {searchTerm.trim() ? t("No matches") : t("No todos")}
          </div>
        )}
        {displayedTodos.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onToggleDone={() => toggleDone(todo.id)}
            onUpdate={(patch) => updateTodo(todo.id, patch)}
            onDelete={() => handleDelete(todo)}
            onExport={() => exportTodo(todo.id)}
            searchTerm={searchTerm}
            tagSuggestions={tagSuggestions}
          />
        ))}
      </div>
      <div data-scroll-wide style={{ flex: 1.2, minHeight: 0, overflowY: "auto", boxShadow: "0 -6px 14px var(--bg-subtle)" }}>
        <TodoMonthCalendar
          todos={calendarTodos}
          month={calendarMonth}
          today={now}
          selectedDay={calendarSelectedDay}
          locale={locale}
          onMonthChange={setCalendarMonth}
          onSelectDay={handleCalendarSelectDay}
        />
      </div>
    </div>
  );
}