"use client";

import { useI18n } from "@/hooks/useI18n";
import { DatePicker } from "@/components/ui/DatePicker";
import type { Todo } from "@/hooks/useTodos";
import { formatDeadline } from "./utils";

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

export function DeadlineControl({
  todo,
  open,
  onOpenChange,
  onChange,
}: {
  todo: Todo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (v: number | undefined) => void;
}) {
  const { t } = useI18n();

  if (todo.deadline === undefined) {
    return (
      <DatePicker
        value={null}
        onChange={(ts) => {
          if (ts == null) return;
          // Bump to end-of-day so the deadline flips at midnight local time
          // the day after.
          onChange(new Date(new Date(ts).setHours(23, 59, 59, 999)).getTime());
        }}
        open={open}
        onOpenChange={onOpenChange}
        ariaLabel={t("Set deadline")}
        renderTrigger={({ open: isOpen, ref, onClick }) => (
          <button
            ref={ref}
            onClick={onClick}
            aria-label={t("Set deadline")}
            title={t("Set deadline")}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 20, height: 20, padding: 0,
              flexShrink: 0,
              background: "transparent",
              border: "none",
              color: isOpen ? "var(--text)" : "var(--text-dim)",
              cursor: "pointer",
              borderRadius: 3,
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = isOpen ? "var(--text)" : "var(--text-dim)")}
          >
            <CalendarIcon />
          </button>
        )}
      />
    );
  }

  const { label, tone, daysAhead } = formatDeadline(todo.deadline);
  const color = todo.done
    ? "var(--text-dim)"
    : tone === "overdue" ? "#ef4444" : tone === "today" ? "var(--accent)" : "#f97316";
  const suffix = todo.done
    ? ""
    : tone === "overdue" ? ` (${t("Overdue")})`
    : tone === "today"   ? ` (${t("Due today")})`
    : ` (${t("In {n} days").replace("{n}", String(daysAhead))})`;
  return (
    <DatePicker
      value={todo.deadline}
      onChange={(ts) => {
        if (ts == null) {
          onChange(undefined);
          return;
        }
        onChange(new Date(new Date(ts).setHours(23, 59, 59, 999)).getTime());
      }}
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel={t("Change deadline")}
      renderTrigger={({ open: isOpen, ref, onClick }) => (
        <button
          ref={ref}
          onClick={onClick}
          aria-label={t("Change deadline")}
          title={t("Change deadline")}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "1px 6px", fontSize: 11,
            flexShrink: 0,
            background: "transparent",
            border: "none",
            color: isOpen ? "var(--text)" : color,
            cursor: "pointer",
            borderRadius: 3,
            fontFamily: "inherit",
            textDecoration: todo.done ? "line-through" : "none",
          }}
          onMouseEnter={(e) => { if (!todo.done) e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = isOpen ? "var(--text)" : color; }}
        >
          <CalendarIcon /> {label}{suffix}
        </button>
      )}
    />
  );
}