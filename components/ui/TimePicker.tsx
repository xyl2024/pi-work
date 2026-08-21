"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, type Locale } from "@/hooks/useI18n";
import { usePopoverPosition } from "@/hooks/usePopoverPosition";

export interface TimeValue {
  /** Hour in 24h clock (0–23). */
  h: number;
  /** Minute (0–59). */
  m: number;
}

interface TimePickerProps {
  /** Selected time. `null`/`undefined` = cleared. */
  value: TimeValue | null | undefined;
  onChange: (v: TimeValue | null) => void;
  /** Text shown on the trigger when nothing is selected. */
  placeholder?: string;
  /** Display format. Default: `"24h"`. */
  format?: "24h" | "12h";
  /** Minute step used in the minute column. Default: `1` (every minute). */
  minuteStep?: 1 | 5 | 10 | 15 | 30;
  /** Earliest selectable time (24h, inclusive). */
  min?: TimeValue;
  /** Latest selectable time (24h, inclusive). */
  max?: TimeValue;
  /** Override the locale used for AM/PM labels. Defaults to the app locale. */
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
  /** Trigger visual sizing. `compact` matches the small DatePicker default;
   *  `regular` produces a full-size form input suitable for standalone forms
   *  (e.g. the scheduler task dialog). Default: `"regular"`. */
  size?: "compact" | "regular";
}

const pad = (n: number) => String(n).padStart(2, "0");

function clampTime(t: TimeValue): TimeValue {
  const h = Math.max(0, Math.min(23, Math.trunc(t.h)));
  const m = Math.max(0, Math.min(59, Math.trunc(t.m)));
  return { h, m };
}

function toMinutes(t: TimeValue): number {
  return t.h * 60 + t.m;
}

/** Convert a 24h hour to a 12h display hour (1-12). */
function to12Hour(h: number): number {
  return h % 12 === 0 ? 12 : h % 12;
}

/** Convert a 12h display hour + AM/PM back to 24h. */
function from12Hour(h12: number, isPm: boolean): number {
  if (h12 === 12) return isPm ? 12 : 0;
  return isPm ? h12 + 12 : h12;
}

function isDisabled(value: TimeValue, min?: TimeValue, max?: TimeValue): boolean {
  const v = toMinutes(value);
  if (min && v < toMinutes(min)) return true;
  if (max && v > toMinutes(max)) return true;
  return false;
}

/** Format a 24h time for display. `locale` only affects AM/PM wording. */
function formatTime(t: TimeValue, format: "24h" | "12h", locale: Locale): string {
  if (format === "24h") return `${pad(t.h)}:${pad(t.m)}`;
  const isAm = t.h < 12;
  const h12 = to12Hour(t.h);
  const suffix = isAm
    ? (locale === "zh" ? "上午" : "AM")
    : (locale === "zh" ? "下午" : "PM");
  return `${pad(h12)}:${pad(t.m)} ${suffix}`;
}

// ── Visual constants ────────────────────────────────────────────
// Each list item is 36px tall; we show 5 items per column (2 above the
// highlighted middle row + 2 below) so the column is always a fixed height.
const ITEM_HEIGHT = 36;
const VISIBLE_ITEMS = 5;
const COLUMN_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS; // 180
const MIDDLE_TOP = Math.floor(VISIBLE_ITEMS / 2) * ITEM_HEIGHT; // top of the highlighted middle row

export function TimePicker({
  value,
  onChange,
  placeholder,
  format = "24h",
  minuteStep = 1,
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
  size = "regular",
}: TimePickerProps) {
  const { t, locale: ctxLocale } = useI18n();
  const loc = locale ?? ctxLocale;

  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? openProp : internalOpen;
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(open) : next;
      if (!isControlled) setInternalOpen(resolved);
      onOpenChange?.(resolved);
    },
    [isControlled, open, onOpenChange],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const popoverPos = usePopoverPosition({
    triggerRef,
    popoverRef,
    open,
    align,
    gap: 6,
  });

  // Mount flag: only render the portal after the first client effect so SSR
  // produces a stable tree (no portal) and the post-hydration render starts
  // the portal cleanly without a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current && containerRef.current.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  // Source-of-truth indices, normalized from `value` so the two columns
  // stay in sync with the controlled value. 0-based.
  const hours24 = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutesArr = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 60; m += minuteStep) out.push(m);
    return out;
  }, [minuteStep]);

  // 12h display hour list: 1..12 (idx 0 = 12).
  const hours12 = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const current = value ?? null;
  const hourList = format === "12h" ? hours12 : hours24;
  const hourIdx = current
    ? (format === "12h" ? to12Hour(current.h) - 1 : current.h)
    : -1;
  const minIdx = current ? Math.min(minutesArr.length - 1, Math.round(current.m / minuteStep)) : -1;
  const isPm = current ? current.h >= 12 : false;

  // Commit a new hour/minute selection WITHOUT closing the popover — let the
  // user adjust both freely before clicking outside to confirm.
  const commitHour = (idx: number) => {
    const h12 = hourList[idx];
    const h24 = format === "12h" ? from12Hour(h12, isPm) : h12;
    const m = current?.m ?? 0;
    const next = clampTime({ h: h24, m });
    if (isDisabled(next, min, max)) return;
    onChange(next);
  };
  const commitMinute = (idx: number) => {
    const h = current?.h ?? 9;
    const next = clampTime({ h, m: minutesArr[idx] });
    if (isDisabled(next, min, max)) return;
    onChange(next);
  };

  const toggleAmPm = (nextIsPm: boolean) => {
    if (!current) return;
    if (nextIsPm === isPm) return;
    const h24 = from12Hour(to12Hour(current.h), nextIsPm);
    onChange({ h: h24, m: current.m });
  };

  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };

  const handleNow = () => {
    const d = new Date();
    onChange({ h: d.getHours(), m: d.getMinutes() });
    // Keep open so the user can fine-tune; clicking outside closes.
  };

  const triggerClick = () => setOpen((v) => !v);

  const formatted = current ? formatTime(current, format, loc) : "";

  const defaultTrigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={triggerClick}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        width: "100%",
        fontSize: size === "regular" ? 12 : 11,
        padding: size === "regular" ? "6px 9px" : "1px 4px",
        border: "1px solid var(--border)",
        borderRadius: size === "regular" ? 6 : 3,
        background: "var(--bg)",
        color: value != null ? "var(--text)" : "var(--text-dim)",
        fontFamily: "inherit",
        cursor: "pointer",
        boxSizing: "border-box",
        textAlign: "left",
        minHeight: size === "regular" ? undefined : 22,
        ...triggerStyle,
      }}
    >
      <ClockIcon size={size === "regular" ? 12 : 10} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
        {value != null ? formatted : (placeholder ?? t("Pick a time"))}
      </span>
      {clearable && value != null && (
        <span
          role="button"
          aria-label={t("Clear")}
          tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(null); }}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 14, height: 14, borderRadius: 3,
            color: "var(--text-dim)", cursor: "pointer", flexShrink: 0,
          }}
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </span>
      )}
    </button>
  );

  const trigger = renderTrigger
    ? renderTrigger({ open, ref: triggerRef, onClick: triggerClick, formatted, hasValue: value != null })
    : defaultTrigger;

  // Splits the value into `displayH` / `displayM` strings for the hero area.
  const heroHH = current ? pad(format === "12h" ? to12Hour(current.h) : current.h) : "--";
  const heroMM = current ? pad(current.m) : "--";

  const popoverNode = mounted ? createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t("Pick a time")}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: popoverPos?.left ?? -9999,
        top: popoverPos?.top ?? -9999,
        visibility: popoverPos ? "visible" : "hidden",
            zIndex: 1000,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 16px 40px rgba(0,0,0,0.36), 0 2px 6px rgba(0,0,0,0.18)",
            padding: 0,
            width: 280,
            userSelect: "none",
            color: "var(--text)",
            fontFamily: "inherit",
            overflow: "hidden",
          }}
        >
          {/* Hero: large HH:MM with optional AM/PM segment. */}
          <div
            style={{
              padding: "20px 18px 16px",
              borderBottom: "1px solid var(--border)",
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--bg-panel) 100%, transparent) 0%, var(--bg) 100%)",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 40,
                lineHeight: 1,
                fontWeight: 300,
                fontFamily: "var(--font-mono)",
                letterSpacing: "-0.02em",
                color: current ? "var(--text)" : "var(--text-dim)",
                fontVariantNumeric: "tabular-nums",
                display: "inline-flex",
                alignItems: "baseline",
                gap: 4,
              }}
              aria-live="polite"
            >
              <span>{heroHH}</span>
              <span style={{ color: "var(--text-dim)", fontWeight: 200 }}>:</span>
              <span>{heroMM}</span>
            </div>
            {format === "12h" && (
              <div
                role="tablist"
                aria-label={t("AM / PM")}
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  overflow: "hidden",
                  background: "var(--bg)",
                  flexShrink: 0,
                }}
              >
                <SegmentButton
                  active={!isPm}
                  onClick={() => toggleAmPm(false)}
                  label={t("AM")}
                />
                <SegmentButton
                  active={isPm}
                  onClick={() => toggleAmPm(true)}
                  label={t("PM")}
                  borderTop
                />
              </div>
            )}
          </div>

          {/* Column header */}
          <div
            style={{
              display: "flex",
              padding: "8px 12px 4px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
            }}
          >
            <div style={{ flex: 1, textAlign: "center" }}>{t("Hour")}</div>
            <div style={{ flex: 1, textAlign: "center" }}>{t("Minute")}</div>
          </div>

          {/* Wheel columns */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "4px 12px 8px",
              position: "relative",
            }}
          >
            <ColumnWheel
              ariaLabel={t("Hour")}
              items={hourList}
              selectedIndex={hourIdx}
              formatItem={(v) => pad(v)}
              onCommit={commitHour}
              isItemDisabled={(idx) => {
                const h24 = format === "12h" ? from12Hour(hourList[idx], isPm) : hourList[idx];
                const probe = { h: h24, m: current?.m ?? 0 };
                return isDisabled(probe, min, max);
              }}
              initialFocus
              // opened flag ensures the scroll-into-view runs every time
              // the popover opens, even if the hour hasn't changed.
              opened={open}
            />
            <ColumnWheel
              ariaLabel={t("Minute")}
              items={minutesArr}
              selectedIndex={minIdx}
              formatItem={(v) => pad(v)}
              onCommit={commitMinute}
              isItemDisabled={(idx) => {
                const probe = { h: current?.h ?? 9, m: minutesArr[idx] };
                return isDisabled(probe, min, max);
              }}
              opened={open}
            />
          </div>

          {/* Footer: now / clear */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-subtle)",
            }}
          >
            <button type="button" onClick={handleClear} style={footerBtnStyle}>
              {t("Clear")}
            </button>
            <button
              type="button"
              onClick={handleNow}
              style={{
                ...footerBtnStyle,
                color: "var(--accent)",
                fontWeight: 600,
              }}
            >
              {t("Now")}
            </button>
          </div>
        </div>,
    document.body,
  ) : null;

  return (
    <div ref={containerRef} style={{ position: "relative", display: renderTrigger ? "inline-block" : "block", width: renderTrigger ? undefined : "100%" }}>
      {trigger}
      {open && popoverNode}
    </div>
  );
}

const footerBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  fontSize: 11,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontFamily: "inherit",
  padding: "4px 8px",
  borderRadius: 4,
  transition: "background 0.1s",
};

// ── Subcomponents ─────────────────────────────────────────────────

interface ColumnWheelProps {
  items: number[];
  selectedIndex: number;
  formatItem: (v: number) => string;
  onCommit: (idx: number) => void;
  isItemDisabled?: (idx: number) => boolean;
  ariaLabel: string;
  opened: boolean;
  initialFocus?: boolean;
}

function ColumnWheel({
  items,
  selectedIndex,
  formatItem,
  onCommit,
  isItemDisabled,
  ariaLabel,
  opened,
  initialFocus,
}: ColumnWheelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // Track the last index the wheel committed via scroll-snap so we don't
  // re-commit on every render after `onCommit` updates `selectedIndex`.
  const lastSnapIdxRef = useRef<number>(-1);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll the selected item into the middle slot whenever the picker opens
  // or the selection changes externally (keyboard, click, AM/PM toggle,
  // "Now"). When the change comes from a wheel-snap commit the scrollTop is
  // already in place, so we skip re-snap to avoid yanking the list while the
  // user is still scrolling.
  useLayoutEffect(() => {
    if (!opened) return;
    const inner = innerRef.current;
    if (!inner) return;
    const target = selectedIndex >= 0 ? selectedIndex : 0;
    const expected = target * ITEM_HEIGHT;
    const diff = Math.abs(inner.scrollTop - expected);
    if (diff > ITEM_HEIGHT / 2) {
      inner.scrollTo({ top: expected, behavior: "auto" });
    }
    lastSnapIdxRef.current = target;
  }, [opened, selectedIndex, items.length]);

  // Wheel-to-select: after the user finishes scrolling, snap the list to the
  // nearest item and commit that item automatically — matching the iOS /
  // Material wheel-picker expectation that the centred row IS the selection.
  const handleScrollEnd = useCallback(() => {
    const inner = innerRef.current;
    if (!inner) return;
    // Snap to the nearest item boundary.
    const target = Math.round(inner.scrollTop / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(items.length - 1, target));
    if (inner.scrollTop !== clamped * ITEM_HEIGHT) {
      inner.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: "auto" });
    }
    if (clamped === lastSnapIdxRef.current) return;
    lastSnapIdxRef.current = clamped;
    if (!isItemDisabled?.(clamped)) onCommit(clamped);
  }, [items.length, isItemDisabled, onCommit]);

  const handleScroll = useCallback(() => {
    // Debounce: treat ~120ms of no-scroll as "the wheel has stopped".
    if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    scrollEndTimerRef.current = setTimeout(handleScrollEnd, 120);
  }, [handleScrollEnd]);

  useEffect(() => {
    return () => {
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    };
  }, []);

  // Auto-focus on open so keyboard ↑↓ works immediately.
  useEffect(() => {
    if (opened && initialFocus) {
      listRef.current?.focus({ preventScroll: true });
    }
  }, [opened, initialFocus]);

  // Keyboard navigation: arrow keys commit immediately so behavior matches
  // mouse click (selection applies; popover stays open until the user clicks
  // outside or presses Escape).
  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const baseIdx = selectedIndex >= 0 ? selectedIndex : 0;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowDown": next = Math.min(items.length - 1, baseIdx + 1); break;
      case "ArrowUp":   next = Math.max(0, baseIdx - 1); break;
      case "PageDown":  next = Math.min(items.length - 1, baseIdx + Math.max(1, Math.floor(VISIBLE_ITEMS / 2))); break;
      case "PageUp":    next = Math.max(0, baseIdx - Math.max(1, Math.floor(VISIBLE_ITEMS / 2))); break;
      case "Home":      next = 0; break;
      case "End":       next = items.length - 1; break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== null && next !== baseIdx && !isItemDisabled?.(next)) {
      onCommit(next);
    }
  };

  // Click = commit + keep open (so the user can adjust the other column).
  const handleClick = (idx: number) => {
    if (isItemDisabled?.(idx)) return;
    onCommit(idx);
  };

  return (
    <div
      ref={listRef}
      tabIndex={0}
      role="listbox"
      aria-label={ariaLabel}
      onKeyDown={handleKey}
      onMouseLeave={() => setHoveredIdx(null)}
      onWheel={(e) => {
        // Don't cancel the native scroll — that would freeze the wheel
        // inside this list. Just stop bubbling so a wheel over the picker
        // doesn't also scroll the page behind it.
        e.stopPropagation();
      }}
      className="timepicker-wheel"
      style={{
        flex: 1,
        height: COLUMN_HEIGHT,
        position: "relative",
        borderRadius: 8,
        // Lift the wheel background a hair above the popover panel so the
        // column still has a perceptible edge, but not enough to read as a
        // distinct "card" — keeps the picker visually flat.
        background: "color-mix(in srgb, var(--bg-panel) 78%, var(--bg) 22%)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Highlighted middle band: marks where the "active" row sits. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 4, right: 4,
          top: MIDDLE_TOP,
          height: ITEM_HEIGHT,
          borderRadius: 6,
          background: "color-mix(in srgb, var(--accent) 14%, transparent)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {/* Scrollable list, with the top/bottom fade so off-axis items feel
          visually "deeper" than the highlighted middle row. */}
      <div
        ref={innerRef}
        data-scroll-inset
        onScroll={handleScroll}
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          overflowY: "auto",
          paddingTop: MIDDLE_TOP,
          paddingBottom: MIDDLE_TOP,
          // Keep the wheel scroll contained — when the list hits the top or
          // bottom the wheel shouldn't bleed through and scroll the page.
          overscrollBehavior: "contain",
          // Top + bottom fade so off-axis items recede into the background.
          maskImage:
            "linear-gradient(to bottom, transparent 0, #000 28%, #000 72%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0, #000 28%, #000 72%, transparent 100%)",
        }}
      >
        {items.map((it, idx) => {
          const selected = idx === selectedIndex;
          const hovered = idx === hoveredIdx && !selected;
          const disabled = isItemDisabled?.(idx) ?? false;
          return (
            <button
              key={idx}
              data-idx={idx}
              type="button"
              role="option"
              aria-selected={selected}
              aria-disabled={disabled}
              disabled={disabled}
              tabIndex={-1}
              onMouseEnter={() => setHoveredIdx(idx)}
              onClick={() => handleClick(idx)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: ITEM_HEIGHT,
                fontSize: 15,
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                background: "transparent",
                border: "none",
                borderRadius: 0,
                cursor: disabled ? "default" : "pointer",
                color: disabled
                  ? "var(--text-dim)"
                  : selected
                    ? "var(--accent)"
                    : hovered
                      ? "var(--text)"
                      : "var(--text-muted)",
                fontWeight: selected ? 700 : 500,
                opacity: disabled ? 0.4 : 1,
                transition: "color 0.08s",
                padding: 0,
                width: "100%",
              }}
            >
              {formatItem(it)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  label,
  borderTop,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  borderTop?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "4px 14px",
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--text-muted)",
        border: "none",
        borderTop: borderTop ? "1px solid var(--border)" : undefined,
        cursor: "pointer",
        fontFamily: "inherit",
        letterSpacing: "0.04em",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}

function ClockIcon({ size = 12 }: { size?: number }) {
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
      <circle cx="6" cy="6" r="4.5" />
      <polyline points="6 3.5 6 6 7.8 7.2" />
    </svg>
  );
}