"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { DatePicker } from "@/components/DatePicker";
import { tagContrastText } from "@/lib/user-todo/color-presets";
import type { Tag, Priority } from "@/hooks/useTodos";
import type { Filters, StatusFilter, DeadlineFilter } from "./types";
import { STATUS_FILTER_OPTIONS, DEADLINE_FILTER_OPTIONS, DEFAULT_FILTERS } from "./utils";

export function FilterPopover({
  filters,
  onChange,
  onClose,
  tagSuggestions,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  onClose: () => void;
  tagSuggestions: Tag[];
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const reset = () => onChange(DEFAULT_FILTERS);

  const toggleTag = (tag: string) => {
    const key = tag.toLowerCase();
    const next = filters.tags.some((t) => t.toLowerCase() === key)
      ? filters.tags.filter((t) => t.toLowerCase() !== key)
      : [...filters.tags, tag];
    onChange({ ...filters, tags: next });
  };

  const togglePriority = (value: Priority | "none") => {
    const next = filters.priorityFilters.includes(value)
      ? filters.priorityFilters.filter((p) => p !== value)
      : [...filters.priorityFilters, value];
    onChange({ ...filters, priorityFilters: next });
  };

  // Color swatch + glyph mirrored from PriorityChip so the filter row is
  // immediately recognizable to anyone who has seen the chip in the list.
  const prioritySwatch = (value: Priority | "none"): { bg: string; fg: string; glyph: string } => {
    switch (value) {
      case "high":
        return { bg: "#ef4444", fg: "#ffffff", glyph: "!" };
      case "medium":
        return { bg: "#f97316", fg: "#ffffff", glyph: "=" };
      case "low":
        return { bg: "#3b82f6", fg: "#ffffff", glyph: "↓" };
      case "none":
        return { bg: "transparent", fg: "var(--text-dim)", glyph: "" };
    }
  };

  const PRIORITY_FILTER_OPTIONS: { value: Priority | "none"; labelKey: string }[] = [
    { value: "high", labelKey: "High priority" },
    { value: "medium", labelKey: "Medium priority" },
    { value: "low", labelKey: "Low priority" },
    { value: "none", labelKey: "No priority" },
  ];

  const renderOption = <K extends string>(
    options: { key: K; labelKey: string }[],
    current: K,
    onSelect: (key: K) => void,
  ) => (
    <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {options.map((o) => {
        const selected = current === o.key;
        return (
          <button
            key={o.key}
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(o.key)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px",
              fontSize: 11,
              textAlign: "left",
              background: selected ? "var(--bg-selected)" : "transparent",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              color: selected ? "var(--text)" : "var(--text-muted)",
              fontFamily: "inherit",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 10, height: 10, flexShrink: 0,
                border: `1.2px solid ${selected ? "var(--accent)" : "var(--text-dim)"}`,
                borderRadius: "50%",
              }}
            >
              {selected && (
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)" }} />
              )}
            </span>
            {t(o.labelKey)}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("Filter")}
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        zIndex: 10,
        minWidth: 168,
        padding: 6,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t("Status")}
        </div>
        {renderOption(STATUS_FILTER_OPTIONS, filters.status, (key) =>
          onChange({ ...filters, status: key as StatusFilter }),
        )}
      </div>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t("Deadline")}
        </div>
        {renderOption(DEADLINE_FILTER_OPTIONS, filters.deadline, (key) =>
          onChange({
            ...filters,
            deadline: key as DeadlineFilter,
            // Custom date range is mutually exclusive with the deadline preset —
            // selecting any non-"all" preset clears the range.
            dateRange: key === "all" ? filters.dateRange : { from: null, to: null },
          }),
        )}
      </div>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t("Date range")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 8px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{ width: 36, flexShrink: 0 }}>{t("From")}</span>
            <DatePicker
              value={filters.dateRange.from}
              onChange={(ts) => {
                onChange({
                  ...filters,
                  dateRange: {
                    from: ts,
                    to: filters.dateRange.to,
                  },
                  // Selecting a range clears the deadline preset.
                  deadline: ts != null ? "all" : filters.deadline,
                });
              }}
              ariaLabel={t("From")}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{ width: 36, flexShrink: 0 }}>{t("To")}</span>
            <DatePicker
              value={filters.dateRange.to}
              onChange={(ts) => {
                // DatePicker emits start-of-day; bump to end-of-day so the
                // "To" upper bound is inclusive of the picked day.
                const next =
                  ts != null
                    ? new Date(new Date(ts).setHours(23, 59, 59, 999)).getTime()
                    : null;
                onChange({
                  ...filters,
                  dateRange: {
                    from: filters.dateRange.from,
                    to: next,
                  },
                  deadline: next != null ? "all" : filters.deadline,
                });
              }}
              ariaLabel={t("To")}
            />
          </label>
          {(filters.dateRange.from != null || filters.dateRange.to != null) && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => onChange({ ...filters, dateRange: { from: null, to: null } })}
                style={{
                  padding: "2px 8px",
                  fontSize: 11,
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t("Clear range")}
              </button>
            </div>
          )}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t("Filter by priority")}
        </div>
        <div role="group" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {PRIORITY_FILTER_OPTIONS.map((o) => {
            const checked = filters.priorityFilters.includes(o.value);
            const swatch = prioritySwatch(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => togglePriority(o.value)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  textAlign: "left",
                  background: checked ? "var(--bg-selected)" : "transparent",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  color: checked ? "var(--text)" : "var(--text-muted)",
                  fontFamily: "inherit",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 10, height: 10, flexShrink: 0,
                    border: `1.2px solid ${checked ? "var(--accent)" : "var(--text-dim)"}`,
                    borderRadius: 2,
                    background: checked ? "var(--accent)" : "transparent",
                    color: "var(--bg)",
                  }}
                >
                  {checked && (
                    <svg width="7" height="7" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="2 5 4.5 7.5 8.5 2.5" />
                    </svg>
                  )}
                </span>
                {/* Mini priority swatch so the filter row previews the same
                    color the chip uses in the list — see PriorityChip below. */}
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 14, height: 14, flexShrink: 0,
                    borderRadius: "50%",
                    background: swatch.bg,
                    color: swatch.fg,
                    border: o.value === "none" ? "1px dashed var(--text-dim)" : "none",
                    fontSize: 9,
                    fontWeight: 600,
                    lineHeight: 1,
                  }}
                >
                  {swatch.glyph}
                </span>
                {t(o.labelKey)}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t("Filter by tags")}
        </div>
        {tagSuggestions.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "4px 8px" }}>
            {t("No tags")}
          </div>
        ) : (
          <div role="group" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {tagSuggestions.map((tag) => {
              const checked = filters.tags.some((t) => t.toLowerCase() === tag.name.toLowerCase());
              return (
                <button
                  key={tag.name}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleTag(tag.name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 8px",
                    fontSize: 11,
                    textAlign: "left",
                    background: checked ? "var(--bg-selected)" : "transparent",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    color: checked ? "var(--text)" : "var(--text-muted)",
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 10, height: 10, flexShrink: 0,
                      border: `1.2px solid ${checked ? "var(--accent)" : "var(--text-dim)"}`,
                      borderRadius: 2,
                      background: checked ? "var(--accent)" : "transparent",
                      color: "var(--bg)",
                    }}
                  >
                    {checked && (
                      <svg width="7" height="7" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="2 5 4.5 7.5 8.5 2.5" />
                      </svg>
                    )}
                  </span>
                  {tag.color ? (
                    <span
                      style={{
                        padding: "0 6px",
                        borderRadius: 8,
                        background: tag.color,
                        color: tagContrastText(tag.color),
                        fontSize: 10,
                        lineHeight: 1.5,
                      }}
                    >
                      {tag.name}
                    </span>
                  ) : (
                    tag.name
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={reset}
          style={{
            padding: "2px 8px",
            fontSize: 11,
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t("Reset filters")}
        </button>
      </div>
    </div>
  );
}