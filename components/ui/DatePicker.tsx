"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n, type Locale } from "@/hooks/useI18n";
import {
  PickerTrigger,
  PopoverPortal,
  useControllableOpen,
  useDismissableLayer,
} from "@/components/ui/popover";

interface DatePickerProps {
  /** Selected day as a unix-ms timestamp. The time component is ignored — the
   *  picker always operates at day granularity. `null`/`undefined` = cleared. */
  value: number | null | undefined;
  onChange: (ts: number | null) => void;
  /** Text shown on the trigger when nothing is selected. */
  placeholder?: string;
  /** Earliest selectable day (inclusive). */
  min?: number;
  /** Latest selectable day (inclusive). */
  max?: number;
  /** Override the locale used for weekday/month names. Defaults to the app locale. */
  locale?: Locale;
  /** Which side of the trigger the popover anchors to. */
  align?: "start" | "end";
  /** Render a custom trigger. Receives helpers to wire up the open state + ref. */
  renderTrigger?: (p: {
    open: boolean;
    ref: React.Ref<HTMLButtonElement>;
    onClick: () => void;
    formatted: string;
    hasValue: boolean;
  }) => React.ReactNode;
  /** Style overrides merged into the default trigger button. Ignored when
   *  `renderTrigger` is provided. */
  triggerStyle?: React.CSSProperties;
  /** Accessible label for the default trigger. */
  ariaLabel?: string;
  /** Show a small "×" inside the trigger to clear the value. Default: true. */
  clearable?: boolean;
  /** Controlled open state. When provided, the picker does not manage its own
   *  open/close state and `onOpenChange` is required. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Trigger visual sizing. `compact` matches the default (small, row-friendly)
   *  style; `regular` produces a full-size form input suitable for standalone
   *  forms (e.g. the scheduler task dialog). Default: `"compact"`. */
  size?: "compact" | "regular";
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isSameDay(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return startOfDay(a) === startOfDay(b);
}

function getMonthLength(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatTriggerLabel(ts: number, locale: Locale): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  return `${y}-${m}-${day} ${weekday}`;
}

const MONTH_NAMES: Record<Locale, string[]> = {
  en: ["January","February","March","April","May","June","July","August","September","October","November","December"],
  zh: ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"],
};

const WEEKDAY_SHORT: Record<Locale, string[]> = {
  en: ["Su","Mo","Tu","We","Th","Fr","Sa"],
  zh: ["日","一","二","三","四","五","六"],
};

export function DatePicker({
  value,
  onChange,
  placeholder,
  min,
  max,
  locale,
  align = "start",
  renderTrigger,
  triggerStyle,
  ariaLabel,
  clearable = true,
  open: openProp,
  onOpenChange,
  size = "compact",
}: DatePickerProps) {
  const { t, locale: ctxLocale } = useI18n();
  const loc = locale ?? ctxLocale;

  const selectedDay = value != null ? startOfDay(value) : null;
  const { open, setOpen } = useControllableOpen(openProp, onOpenChange);

  // The month being viewed in the popover. Resets to the selected day (or
  // today) every time the popover opens, so users always land on a relevant
  // month.
  const [viewYear, setViewYear] = useState(() => {
    const v = selectedDay ?? startOfDay(Date.now());
    return new Date(v).getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const v = selectedDay ?? startOfDay(Date.now());
    return new Date(v).getMonth();
  });
  // Snapshot of "today" so the "today" highlight stays stable across renders
  // (avoids the react-hooks/purity rule against Date.now() during render).
  const [today, setToday] = useState(() => startOfDay(Date.now()));

  useEffect(() => {
    if (!open) return;
    const v = selectedDay ?? startOfDay(Date.now());
    setViewYear(new Date(v).getFullYear());
    setViewMonth(new Date(v).getMonth());
    setToday(startOfDay(Date.now()));
  }, [open, selectedDay]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape (Escape also restores focus to the
  // trigger). Both behaviours were previously inlined; they now live in
  // the shared dismissable-layer hook.
  useDismissableLayer({
    enabled: open,
    containerRef,
    triggerRef,
    onDismiss: () => setOpen(false),
  });

  const goPrevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);
  const goNextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const monthLength = getMonthLength(viewYear, viewMonth);
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Sun
  const cells: Array<{ day: number; ts: number } | null> = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= monthLength; d++) {
    cells.push({ day: d, ts: new Date(viewYear, viewMonth, d).getTime() });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const isDisabled = (ts: number) => {
    if (min != null && ts < startOfDay(min)) return true;
    if (max != null && ts > startOfDay(max)) return true;
    return false;
  };

  const handleSelect = (ts: number) => {
    onChange(ts);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };

  const handleToday = () => {
    onChange(startOfDay(Date.now()));
    setOpen(false);
  };

  const triggerClick = () => setOpen((v) => !v);
  const handleTriggerClear = () => {
    onChange(null);
  };
  const formatted = value != null ? formatTriggerLabel(value, loc) : "";

  const trigger = renderTrigger ? (
    renderTrigger({ open, ref: triggerRef, onClick: triggerClick, formatted, hasValue: value != null })
  ) : (
    <PickerTrigger
      ref={triggerRef}
      open={open}
      onClick={triggerClick}
      icon={<CalendarIcon size={size === "regular" ? 12 : 10} />}
      label={formatted}
      placeholder={placeholder ?? t("Pick a date")}
      clearable={clearable}
      hasValue={value != null}
      onClear={handleTriggerClear}
      ariaLabel={ariaLabel}
      size={size}
      style={triggerStyle}
    />
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        display: renderTrigger ? "inline-block" : "block",
        width: renderTrigger ? undefined : "100%",
      }}
    >
      {trigger}
      <PopoverPortal
        open={open}
        triggerRef={triggerRef}
        popoverRef={popoverRef}
        align={align}
        gap={4}
        contentDeps={[viewYear, viewMonth]}
        ariaLabel={t("Pick a date")}
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
          padding: 10,
          width: 240,
          userSelect: "none",
          color: "var(--text)",
          fontFamily: "inherit",
        }}
      >
        {/* Header: prev / month-year / next */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
          <button type="button" onClick={goPrevMonth} aria-label={t("Previous month")} style={navBtnStyle}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 2 3 5 6 8" />
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            {MONTH_NAMES[loc][viewMonth]} {viewYear}
          </div>
          <button type="button" onClick={goNextMonth} aria-label={t("Next month")} style={navBtnStyle}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 2 7 5 4 8" />
            </svg>
          </button>
        </div>

        {/* Weekday header */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
          {WEEKDAY_SHORT[loc].map((w) => (
            <div key={w} style={{ textAlign: "center", fontSize: 10, color: "var(--text-dim)", padding: "2px 0", fontWeight: 500 }}>
              {w}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {cells.map((cell, i) => {
            if (!cell) return <div key={i} />;
            const disabled = isDisabled(cell.ts);
            const isSelected = isSameDay(cell.ts, selectedDay);
            const isToday = isSameDay(cell.ts, today);
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => handleSelect(cell.ts)}
                onMouseEnter={(e) => {
                  if (disabled || isSelected) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (disabled || isSelected) return;
                  e.currentTarget.style.background = "transparent";
                }}
                aria-pressed={isSelected}
                style={{
                  aspectRatio: "1 / 1",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11,
                  border: "none",
                  borderRadius: 5,
                  cursor: disabled ? "default" : "pointer",
                  background: isSelected ? "var(--accent)" : "transparent",
                  color: isSelected ? "#fff" : disabled ? "var(--text-dim)" : "var(--text)",
                  fontWeight: isToday && !isSelected ? 600 : 400,
                  boxShadow: isToday && !isSelected ? "inset 0 0 0 1px var(--text-dim)" : "none",
                  opacity: disabled ? 0.35 : 1,
                  fontFamily: "inherit",
                  padding: 0,
                  transition: "background 0.1s",
                }}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        {/* Footer: clear / today */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            onClick={handleClear}
            style={footerBtnStyle}
          >
            {t("Clear")}
          </button>
          <button
            type="button"
            onClick={handleToday}
            style={{ ...footerBtnStyle, color: "var(--accent)", fontWeight: 500 }}
          >
            {t("Today")}
          </button>
        </div>
      </PopoverPortal>
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontFamily: "inherit",
  padding: 0,
  flexShrink: 0,
};

const footerBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  fontSize: 11,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontFamily: "inherit",
  padding: "2px 6px",
  borderRadius: 3,
};

function CalendarIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      <rect x="1.5" y="3" width="9" height="8" rx="1" />
      <line x1="1.5" y1="5.5" x2="10.5" y2="5.5" />
      <line x1="4" y1="1.5" x2="4" y2="3.5" />
      <line x1="8" y1="1.5" x2="8" y2="3.5" />
    </svg>
  );
}
