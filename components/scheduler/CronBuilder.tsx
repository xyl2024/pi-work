import { useEffect, useMemo, useState } from "react";
import { Cron } from "croner";
import { useI18n, type Locale } from "@/hooks/useI18n";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker, type TimeValue } from "@/components/ui/TimePicker";
import { inputStyle } from "./styles";
import { cronHumanize, parseDowList, DAY_ORDER } from "./utils";
import { NumberStepper } from "@/components/ui/NumberStepper";

const WEEKDAY_LABELS: Record<Locale, string[]> = {
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseHHMM(v: string): TimeValue | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!timeInRange(h, mi)) return null;
  return { h, m: mi };
}

const isInt = (s: string) => /^\d{1,2}$/.test(s);
const pad = (n: number) => String(n).padStart(2, "0");

export type CronMode = "daily" | "weekly" | "interval" | "once" | "advanced";

export interface ScheduleState {
  mode: CronMode;
  h: number;
  m: number;
  days: number[];
  hours: number;
  date: string;
  time: string;
}

function defaultState(): ScheduleState {
  return {
    mode: "daily",
    h: 9,
    m: 0,
    days: [1, 2, 3, 4, 5],
    hours: 2,
    date: "",
    time: "09:00",
  };
}

export function parseCronToState(cron: string): ScheduleState {
  const parts = cron.trim().split(/\s+/);
  const base = defaultState();

  if (parts.length === 7 && parts[0] === "0" && parts[5] === "*" && /^\d{4}$/.test(parts[6])) {
    const [y, mon, d, h, m] = [Number(parts[6]), Number(parts[4]), Number(parts[3]), Number(parts[2]), Number(parts[1])];
    if (Number.isInteger(y) && Number.isInteger(mon) && Number.isInteger(d) && Number.isInteger(h) && Number.isInteger(m)
      && mon >= 1 && mon <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { ...base, mode: "once", date: `${y}-${pad(mon)}-${pad(d)}`, time: `${pad(h)}:${pad(m)}` };
    }
  }

  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    if (isInt(min) && isInt(hour) && dom === "*" && mon === "*" && dow === "*") {
      return { ...base, mode: "daily", h: Number(hour), m: Number(min) };
    }
    if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*") {
      const n = Number(hour.slice(2));
      if (Number.isInteger(n) && n > 0) {
        return { ...base, mode: "interval", hours: n, days: parseDowList(dow) };
      }
    }
    if (isInt(min) && isInt(hour) && dom === "*" && mon === "*") {
      const days = parseDowList(dow);
      if (days.length > 0) {
        return { ...base, mode: "weekly", h: Number(hour), m: Number(min), days };
      }
    }
  }

  return { ...base, mode: "advanced" };
}

export function stateToCron(state: ScheduleState): string {
  switch (state.mode) {
    case "daily":
      return `${state.m} ${state.h} * * *`;
    case "weekly":
      return `${state.m} ${state.h} * * ${dowStr(state.days)}`;
    case "interval":
      return `0 */${state.hours} * * ${dowStr(state.days)}`;
    case "once": {
      const [y, mon, d] = state.date.split("-").map(Number);
      const [h, mi] = state.time.split(":").map(Number);
      return `0 ${mi} ${h} ${d} ${mon} * ${y}`;
    }
    case "advanced":
      return "";
  }
}

function dowStr(days: number[]): string {
  if (days.length === 0) return "*";
  if (days.length === 7) return "*";
  return days.slice().sort((a, b) => a - b).join(",");
}

const timeInRange = (h: number, m: number) =>
  Number.isInteger(h) && h >= 0 && h <= 23 && Number.isInteger(m) && m >= 0 && m <= 59;

export function stateValid(state: ScheduleState, now: number): boolean {
  switch (state.mode) {
    case "daily":
      return timeInRange(state.h, state.m);
    case "weekly":
      return state.days.length > 0 && timeInRange(state.h, state.m);
    case "interval":
      return Number.isInteger(state.hours) && state.hours >= 1 && state.hours <= 23 && state.days.length > 0;
    case "once": {
      if (!state.date || !state.time) return false;
      const ts = new Date(`${state.date}T${state.time}`).getTime();
      return Number.isFinite(ts) && ts > now;
    }
    case "advanced":
      return false;
  }
}

const PRESETS: { id: string; cron: string; label: string }[] = [
  { id: "every-minute",    cron: "* * * * *",   label: "Every minute" },
  { id: "every-5-minutes", cron: "*/5 * * * *", label: "Every 5 minutes" },
  { id: "every-15-minutes",cron: "*/15 * * * *",label: "Every 15 minutes" },
  { id: "every-hour",      cron: "0 * * * *",   label: "Every hour" },
  { id: "every-6-hours",   cron: "0 */6 * * *", label: "Every 6 hours" },
  { id: "daily-9am",       cron: "0 9 * * *",   label: "Daily at 09:00" },
  { id: "weekdays-9am",    cron: "0 9 * * 1-5", label: "Weekdays at 09:00" },
  { id: "monday-8am",      cron: "0 8 * * 1",   label: "Monday at 08:00" },
];

function TimeField({ value, onChange, label }: { value: TimeValue | null; onChange: (v: TimeValue) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ width: 130 }}>
        <TimePicker
          size="regular"
          value={value}
          onChange={(v) => v && onChange(v)}
          ariaLabel={label}
        />
      </div>
    </label>
  );
}

function DayChips({ days, onChange, invalid }: { days: number[]; onChange: (d: number[]) => void; invalid: boolean }) {
  const { t, locale } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("Only on these days")}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {DAY_ORDER.map((v) => {
          const active = days.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => {
                const next = active ? days.filter((d) => d !== v) : [...days, v];
                onChange(next);
              }}
              style={{
                padding: "4px 11px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: active ? "var(--accent)" : "var(--border)",
                background: active ? "var(--bg-selected)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-muted)",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {WEEKDAY_LABELS[locale][v]}
            </button>
          );
        })}
      </div>
      {invalid && (
        <span style={{ fontSize: 11, color: "var(--error)" }}>{t("At least one day required")}</span>
      )}
    </div>
  );
}

interface CronBuilderProps {
  value: string;
  onChange: (cron: string, valid: boolean) => void;
  showPreview?: boolean;
}

export function CronBuilder({ value, onChange, showPreview = true }: CronBuilderProps) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<ScheduleState>(() => parseCronToState(value));
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const patch = (next: ScheduleState) => {
    setState(next);
    onChange(stateToCron(next), stateValid(next, nowMs));
  };

  const switchMode = (mode: CronMode) => {
    if (mode === "advanced") {
      setState((prev) => ({ ...prev, mode }));
      return;
    }
    const parsed = parseCronToState(value);
    const next: ScheduleState = {
      ...defaultState(),
      mode,
      ...(state.mode !== "advanced" ? { h: state.h, m: state.m, days: state.days, hours: state.hours, date: state.date, time: state.time } : {}),
    };
    if (mode === "daily" && parsed.mode === "daily") { next.h = parsed.h; next.m = parsed.m; }
    if (mode === "weekly" && parsed.mode === "weekly") { next.h = parsed.h; next.m = parsed.m; next.days = parsed.days; }
    if (mode === "interval" && parsed.mode === "interval") { next.hours = parsed.hours; next.days = parsed.days; }
    if (mode === "once" && parsed.mode === "once") { next.date = parsed.date; next.time = parsed.time; }
    setState(next);
    onChange(stateToCron(next), stateValid(next, nowMs));
  };

  const advancedValid = useMemo(() => {
    try { new Cron(value); return true; } catch { return false; }
  }, [value]);

  const applyPreset = (cron: string) => {
    let valid = true;
    try { new Cron(cron); } catch { valid = false; }
    onChange(cron, valid);
  };

  const cronValid = state.mode === "advanced" ? advancedValid : stateValid(state, nowMs);
  const upcoming = useMemo(() => {
    try {
      const c = new Cron(value);
      const out: number[] = [];
      let cursor = new Date();
      for (let i = 0; i < 3; i++) {
        const n = c.nextRun(cursor);
        if (!n) break;
        out.push(n.getTime());
        cursor = n;
      }
      return out;
    } catch {
      return [];
    }
  }, [value]);

  const inlineWarning = (() => {
    if (state.mode === "advanced") return null;
    if (state.mode === "daily" || state.mode === "weekly") {
      if (!timeInRange(state.h, state.m)) return t("Pick a time");
    }
    if ((state.mode === "weekly" || state.mode === "interval") && state.days.length === 0) {
      return t("At least one day required");
    }
    if (state.mode === "interval" && !(Number.isInteger(state.hours) && state.hours >= 1 && state.hours <= 23)) {
      return t("Hours must be between 1 and 23");
    }
    if (state.mode === "once") {
      if (!state.date || !state.time) return t("Pick a date and time");
      const ts = new Date(`${state.date}T${state.time}`).getTime();
      if (!Number.isFinite(ts)) return t("Invalid date");
      if (ts <= nowMs) return t("This time has passed");
    }
    return null;
  })();

  const modeTabs: { id: CronMode; label: string }[] = [
    { id: "daily", label: t("Daily") },
    { id: "weekly", label: t("Weekly") },
    { id: "interval", label: t("Every N hours") },
    { id: "once", label: t("Once") },
    { id: "advanced", label: t("Advanced") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {modeTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => switchMode(tab.id)}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid",
              borderColor: state.mode === tab.id ? "var(--accent)" : "var(--border)",
              background: state.mode === tab.id ? "var(--bg-selected)" : "transparent",
              color: state.mode === tab.id ? "var(--accent)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: state.mode === tab.id ? 600 : 400,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {state.mode === "daily" && (
        <TimeField
          label={t("Time")}
          value={timeInRange(state.h, state.m) ? { h: state.h, m: state.m } : null}
          onChange={(v) => patch({ ...state, mode: "daily", h: v.h, m: v.m })}
        />
      )}

      {state.mode === "weekly" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <TimeField
            label={t("Time")}
            value={timeInRange(state.h, state.m) ? { h: state.h, m: state.m } : null}
            onChange={(v) => patch({ ...state, mode: "weekly", h: v.h, m: v.m })}
          />
          <DayChips days={state.days} invalid={state.days.length === 0} onChange={(days) => patch({ ...state, mode: "weekly", days })} />
        </div>
      )}

      {state.mode === "interval" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t("Every")}</span>
            <NumberStepper
              value={state.hours}
              onChange={(hours) => patch({ ...state, mode: "interval", hours })}
              min={1}
              max={23}
              ariaLabel={t("Hours")}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t("Hours")}</span>
          </label>
          <DayChips days={state.days} invalid={state.days.length === 0} onChange={(days) => patch({ ...state, mode: "interval", days })} />
        </div>
      )}

      {state.mode === "once" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t("Date")}</span>
            <div style={{ width: 170 }}>
              <DatePicker
                size="regular"
                value={state.date ? new Date(state.date).getTime() : null}
                onChange={(ts) => {
                  if (ts == null) {
                    patch({ ...state, mode: "once", date: "" });
                    return;
                  }
                  const d = new Date(ts);
                  patch({ ...state, mode: "once", date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` });
                }}
                min={startOfToday()}
                ariaLabel={t("Date")}
              />
            </div>
          </label>
          <TimeField
            label={t("Time")}
            value={parseHHMM(state.time)}
            onChange={(v) => patch({ ...state, mode: "once", time: `${pad(v.h)}:${pad(v.m)}` })}
          />
        </div>
      )}

      {state.mode === "advanced" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="text"
            value={value}
            spellCheck={false}
            autoComplete="off"
            placeholder="*/30 * * * *"
            onChange={(e) => {
              const v = e.target.value;
              let valid = true;
              try { new Cron(v); } catch { valid = false; }
              onChange(v, valid);
            }}
            style={{
              ...inputStyle,
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              borderColor: advancedValid ? "var(--border)" : "var(--error)",
            }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>
              {t("Presets")}
            </span>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.cron)}
                style={{
                  padding: "3px 9px",
                  fontSize: 11,
                  background: value === p.cron ? "var(--bg-selected)" : "transparent",
                  border: "1px solid var(--border)",
                  borderColor: value === p.cron ? "var(--accent)" : "var(--border)",
                  borderRadius: 999,
                  color: value === p.cron ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t(p.label)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <code
            style={{
              fontFamily: "var(--font-mono)",
              padding: "2px 7px",
              borderRadius: 4,
              background: cronValid ? "var(--bg)" : "var(--error-bg)",
              color: cronValid ? "var(--text)" : "var(--error)",
              border: "1px solid",
              borderColor: cronValid ? "var(--border)" : "var(--error)",
              fontSize: 11,
            }}
          >
            {value}
          </code>
          {!cronValid && <span style={{ color: "var(--error)" }}>{inlineWarning ?? t("Syntax error")}</span>}
        </div>

        {showPreview && (
          <>
            <div>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>{t("Description:")}</span> {cronHumanize(value, locale)}
            </div>
            {upcoming.length > 0 ? (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontFamily: "var(--font-mono)" }}>
                {upcoming.map((ts) => (
                  <span key={ts}>{new Date(ts).toLocaleString()}</span>
                ))}
              </div>
            ) : cronValid ? (
              <div style={{ color: "var(--warning)" }}>{t("This time has passed")}</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
