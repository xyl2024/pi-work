"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n, type Locale } from "@/hooks/useI18n";
import {
  PickerTrigger,
  PopoverPortal,
  useControllableOpen,
  useDismissableLayer,
} from "@/components/ui/popover";

export interface TimeValue {
  h: number;
  m: number;
}

interface TimePickerProps {
  value: TimeValue | null | undefined;
  onChange: (v: TimeValue | null) => void;
  placeholder?: string;
  format?: "24h" | "12h";
  minuteStep?: 1 | 5 | 10 | 15 | 30;
  min?: TimeValue;
  max?: TimeValue;
  locale?: Locale;
  align?: "start" | "end";
  renderTrigger?: (p: {
    open: boolean;
    ref: React.Ref<HTMLButtonElement>;
    onClick: () => void;
    formatted: string;
    hasValue: boolean;
  }) => React.ReactNode;
  triggerStyle?: React.CSSProperties;
  ariaLabel?: string;
  clearable?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

function to12Hour(h: number): number {
  return h % 12 === 0 ? 12 : h % 12;
}

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

function formatTime(t: TimeValue, format: "24h" | "12h", locale: Locale): string {
  if (format === "24h") return `${pad(t.h)}:${pad(t.m)}`;
  const isAm = t.h < 12;
  const h12 = to12Hour(t.h);
  const suffix = isAm
    ? (locale === "zh" ? "上午" : "AM")
    : (locale === "zh" ? "下午" : "PM");
  return `${pad(h12)}:${pad(t.m)} ${suffix}`;
}

const ITEM_HEIGHT = 36;
const VISIBLE_ITEMS = 5;
const COLUMN_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const MIDDLE_TOP = Math.floor(VISIBLE_ITEMS / 2) * ITEM_HEIGHT;

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

  const { open, setOpen } = useControllableOpen(openProp, onOpenChange);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useDismissableLayer({
    enabled: open,
    containerRef,
    triggerRef,
    onDismiss: () => setOpen(false),
  });

  const hours24 = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutesArr = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 60; m += minuteStep) out.push(m);
    return out;
  }, [minuteStep]);

  const hours12 = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const current = value ?? null;
  const hourList = format === "12h" ? hours12 : hours24;
  const hourIdx = current
    ? (format === "12h" ? to12Hour(current.h) - 1 : current.h)
    : -1;
  const minIdx = current ? Math.min(minutesArr.length - 1, Math.round(current.m / minuteStep)) : -1;
  const isPm = current ? current.h >= 12 : false;

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
  };

  const triggerClick = () => setOpen((v) => !v);
  const handleTriggerClear = () => {
    onChange(null);
  };

  const formatted = current ? formatTime(current, format, loc) : "";

  const trigger = renderTrigger ? (
    renderTrigger({ open, ref: triggerRef, onClick: triggerClick, formatted, hasValue: value != null })
  ) : (
    <PickerTrigger
      ref={triggerRef}
      open={open}
      onClick={triggerClick}
      icon={<ClockIcon size={size === "regular" ? 12 : 10} />}
      label={formatted}
      placeholder={placeholder ?? t("Pick a time")}
      clearable={clearable}
      hasValue={value != null}
      onClear={handleTriggerClear}
      ariaLabel={ariaLabel}
      size={size}
      style={triggerStyle}
      monoLabel
    />
  );

  const heroHH = current ? pad(format === "12h" ? to12Hour(current.h) : current.h) : "--";
  const heroMM = current ? pad(current.m) : "--";

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
        gap={6}
        ariaLabel={t("Pick a time")}
        style={{
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
      </PopoverPortal>
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
  const lastSnapIdxRef = useRef<number>(-1);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleScrollEnd = useCallback(() => {
    const inner = innerRef.current;
    if (!inner) return;
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
    if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    scrollEndTimerRef.current = setTimeout(handleScrollEnd, 120);
  }, [handleScrollEnd]);

  useEffect(() => {
    return () => {
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (opened && initialFocus) {
      listRef.current?.focus({ preventScroll: true });
    }
  }, [opened, initialFocus]);

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
        e.stopPropagation();
      }}
      className="timepicker-wheel"
      style={{
        flex: 1,
        height: COLUMN_HEIGHT,
        position: "relative",
        borderRadius: 8,
        background: "color-mix(in srgb, var(--bg-panel) 78%, var(--bg) 22%)",
        border: "1px solid var(--border)",
      }}
    >
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
          overscrollBehavior: "contain",
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
