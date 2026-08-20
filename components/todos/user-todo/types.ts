"use client";

import type { Priority } from "@/hooks/useTodos";

export type StatusFilter = "all" | "active" | "done";
export type DeadlineFilter = "all" | "overdue" | "today" | "thisWeek" | "thisMonth" | "noDeadline";

export type Filters = {
  status: StatusFilter;
  deadline: DeadlineFilter;
  dateRange: { from: number | null; to: number | null };
  tags: string[];
  /**
   * Multi-select priority filter. Empty array = no filter (show all). When
   * non-empty, a todo is included iff its `priority` matches one of the
   * entries, OR (when the array contains the literal `"none"`) it has no
   * priority set. The list view always sorts by priority regardless —
   * this only narrows which rows are visible.
   */
  priorityFilters: (Priority | "none")[];
};

export type DeadlineTone = "overdue" | "today" | "future";