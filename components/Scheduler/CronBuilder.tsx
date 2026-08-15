/**
 * CronBuilder — 5-segment visual cron editor.
 *
 * Each segment is a dropdown that supports three modes:
 *   - `*`     → every
 *   - `star/N`   → every N units (preset values for speed)
 *   - specific value(s) → specific values (multi-select chips)
 *
 * The composited cron is shown live below the dropdowns, plus the
 * natural-language humanization and a 3-row next-runs preview.
 * Any invalid state surfaces inline; the parent's `onChange` only
 * fires with syntactically valid expressions so a Save button can
 * gate purely on the boolean.
 *
 * `value` is a 5-segment cron string. `onChange` is called whenever
 * the user finishes editing a segment.
 */

import { useCallback, useMemo } from "react";
import { Cron } from "croner";
import { IconChevronDown } from "./icons";
import { inputStyle, optionButtonStyle } from "./styles";
import { cronHumanize } from "./utils";

// ── Field model ──────────────────────────────────────────────────

type FieldMode = "any" | "every" | "specific";

interface ParsedField {
  mode: FieldMode;
  /** For mode="every": the N value (e.g. 5 maps to `star/5`). */
  every?: number;
  /** For mode="specific": the list of values. */
  values?: number[];
  /** Raw segment text — used as fallback when nothing else fits. */
  raw: string;
}

const MINUTE_MAX = 59;
const HOUR_MAX = 23;
const DOM_MAX = 31;
const MONTH_MAX = 12;
const DOW_MAX = 6;

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];

/** Parse a single cron segment into one of our three modes. Best-effort:
 *  unrecognized patterns fall back to "any" so the editor stays usable. */
function parseField(segment: string, max: number): ParsedField {
  const trimmed = segment.trim();
  if (!trimmed || trimmed === "*") return { mode: "any", raw: "*" };
  if (trimmed.startsWith("*/")) {
    const n = Number(trimmed.slice(2));
    if (Number.isFinite(n) && n > 0) return { mode: "every", every: n, raw: trimmed };
    return { mode: "any", raw: trimmed };
  }
  // Specific values: "1", "1,2,3", "1-5"
  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  const values: number[] = [];
  for (const p of parts) {
    if (p.includes("-")) {
      const [lo, hi] = p.split("-").map(Number);
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi <= max && lo <= hi) {
        for (let i = lo; i <= hi; i++) values.push(i);
        continue;
      }
    } else {
      const n = Number(p);
      if (Number.isFinite(n) && n >= 0 && n <= max) {
        values.push(n);
        continue;
      }
    }
    // Unrecognized token — give up on parse, fall back
    return { mode: "any", raw: trimmed };
  }
  return { mode: "specific", values: Array.from(new Set(values)).sort((a, b) => a - b), raw: trimmed };
}

function renderField(field: ParsedField, max: number): string {
  if (field.mode === "any") return "*";
  if (field.mode === "every") {
    const n = field.every ?? 1;
    if (n <= 0) return "*";
    return `*/${n}`;
  }
  if (field.mode === "specific") {
    const vs = (field.values ?? []).filter((v) => v >= 0 && v <= max).sort((a, b) => a - b);
    if (vs.length === 0) return "*";
    return vs.join(",");
  }
  return field.raw;
}

// ── Presets ──────────────────────────────────────────────────────

const PRESETS: { id: string; cron: string; label: string }[] = [
  { id: "every-minute",    cron: "* * * * *",   label: "每分钟" },
  { id: "every-5-minutes", cron: "*/5 * * * *", label: "每 5 分钟" },
  { id: "every-15-minutes",cron: "*/15 * * * *",label: "每 15 分钟" },
  { id: "every-hour",      cron: "0 * * * *",   label: "每小时整点" },
  { id: "every-6-hours",   cron: "0 */6 * * *", label: "每 6 小时" },
  { id: "daily-9am",       cron: "0 9 * * *",   label: "每天 09:00" },
  { id: "weekdays-9am",    cron: "0 9 * * 1-5", label: "工作日 09:00" },
  { id: "monday-8am",      cron: "0 8 * * 1",   label: "周一 08:00" },
];

// ── Segment dropdown ─────────────────────────────────────────────

interface SegmentProps {
  label: string;
  field: ParsedField;
  max: number;
  /** Presets for the "every N" mode. Empty falls back to N=1. */
  everyPresets: number[];
  /** If set, "specific" mode shows these named chips instead of raw numbers
   *  (used for day-of-week to render 周一/周二/...). */
  namedValues?: { value: number; label: string }[];
  onChange: (field: ParsedField) => void;
}

function SegmentDropdown({ label, field, max, everyPresets, namedValues, onChange }: SegmentProps) {
  const summary = (() => {
    if (field.mode === "any") return "任意";
    if (field.mode === "every") return `每 ${field.every ?? 1}`;
    if (field.mode === "specific") {
      const vs = field.values ?? [];
      if (vs.length === 0) return "任意";
      if (namedValues) {
        return vs.map((v) => namedValues[v]?.label ?? String(v)).join("、");
      }
      return vs.join(", ");
    }
    return field.raw;
  })();

  return (
    <div style={{ flex: "1 1 0", minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label}
      </div>
      <details style={{ position: "relative" }}>
        <summary
          style={{
            ...inputStyle,
            listStyle: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
          <IconChevronDown width={10} height={10} />
        </summary>
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 1100,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
            padding: 4,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onChange({ mode: "any", raw: "*" }); }}
            style={optionButtonStyle(field.mode === "any")}
          >
            <span style={{ width: 10 }} />
            <span style={{ flex: 1 }}>任意 (*)</span>
          </button>
          <div style={{ padding: "4px 10px 2px", fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            每 N
          </div>
          {everyPresets.map((n) => (
            <button
              key={n}
              type="button"
              onClick={(e) => { e.preventDefault(); onChange({ mode: "every", every: n, raw: `*/${n}` }); }}
              style={optionButtonStyle(field.mode === "every" && field.every === n)}
            >
              <span style={{ width: 10 }} />
              <span style={{ flex: 1 }}>每 {n}</span>
              <code style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>*/{n}</code>
            </button>
          ))}
          <div style={{ padding: "4px 10px 2px", fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", borderTop: "1px solid var(--border)", marginTop: 4 }}>
            特定
          </div>
          <SpecificChips field={field} max={max} namedValues={namedValues} onChange={onChange} />
        </div>
      </details>
    </div>
  );
}

function SpecificChips({ field, max, namedValues, onChange }: { field: ParsedField; max: number; namedValues?: { value: number; label: string }[]; onChange: (f: ParsedField) => void }) {
  const items = namedValues
    ? namedValues
    : Array.from({ length: max + 1 }, (_, i) => ({ value: i, label: String(i) }));
  const active = new Set(field.mode === "specific" ? field.values ?? [] : []);

  const toggle = (v: number) => {
    const next = new Set(active);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange({
      mode: "specific",
      values: Array.from(next).sort((a, b) => a - b),
      raw: Array.from(next).sort((a, b) => a - b).join(","),
    });
  };

  return (
    <div style={{ padding: "4px 8px 8px", display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={(e) => { e.preventDefault(); toggle(it.value); }}
          style={{
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid",
            borderColor: active.has(it.value) ? "var(--accent)" : "var(--border)",
            background: active.has(it.value) ? "var(--bg-selected)" : "transparent",
            color: active.has(it.value) ? "var(--accent)" : "var(--text-muted)",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: namedValues ? "inherit" : "var(--font-mono)",
            minWidth: 30,
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ── Top-level component ──────────────────────────────────────────

interface CronBuilderProps {
  value: string;
  onChange: (cron: string, valid: boolean) => void;
  /** When true, show the natural-language description + next-runs preview. */
  showPreview?: boolean;
}

export function CronBuilder({ value, onChange, showPreview = true }: CronBuilderProps) {
  const segments = useMemo(() => value.trim().split(/\s+/), [value]);
  const padded = useMemo(() => {
    return segments.length === 5
      ? segments
      : segments.length < 5
        ? [...segments, ...Array(5 - segments.length).fill("*")]
        : segments.slice(0, 5);
  }, [segments]);

  const fields: [ParsedField, ParsedField, ParsedField, ParsedField, ParsedField] = useMemo(() => [
    parseField(padded[0], MINUTE_MAX),
    parseField(padded[1], HOUR_MAX),
    parseField(padded[2], DOM_MAX),
    parseField(padded[3], MONTH_MAX),
    parseField(padded[4], DOW_MAX),
  ], [padded]);

  const validity = useMemo(() => {
    try { new Cron(padded.join(" ")); return true; }
    catch { return false; }
  }, [padded]);

  const compose = useCallback((idx: number, next: ParsedField) => {
    const newFields = [...fields];
    newFields[idx] = next;
    const segs = newFields.map((f, i) => renderField(f, [MINUTE_MAX, HOUR_MAX, DOM_MAX, MONTH_MAX, DOW_MAX][i]));
    const cron = segs.join(" ");
    let valid = true;
    try { new Cron(cron); } catch { valid = false; }
    onChange(cron, valid);
  }, [fields, onChange]);

  const applyPreset = (cron: string) => {
    let valid = true;
    try { new Cron(cron); } catch { valid = false; }
    onChange(cron, valid);
  };

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <SegmentDropdown
          label="分钟"
          field={fields[0]}
          max={MINUTE_MAX}
          everyPresets={[1, 5, 10, 15, 20, 30]}
          onChange={(f) => compose(0, f)}
        />
        <SegmentDropdown
          label="小时"
          field={fields[1]}
          max={HOUR_MAX}
          everyPresets={[1, 2, 3, 4, 6, 12]}
          onChange={(f) => compose(1, f)}
        />
        <SegmentDropdown
          label="日"
          field={fields[2]}
          max={DOM_MAX}
          everyPresets={[]}
          onChange={(f) => compose(2, f)}
        />
        <SegmentDropdown
          label="月"
          field={fields[3]}
          max={MONTH_MAX}
          everyPresets={[]}
          onChange={(f) => compose(3, f)}
        />
        <SegmentDropdown
          label="周"
          field={fields[4]}
          max={DOW_MAX}
          everyPresets={[]}
          namedValues={WEEKDAY_LABELS.map((label, value) => ({ value, label }))}
          onChange={(f) => compose(4, f)}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <code
          style={{
            ...inputStyle,
            width: "auto",
            padding: "4px 10px",
            fontFamily: "var(--font-mono)",
            background: validity ? "var(--bg-subtle)" : "var(--error-bg)",
            color: validity ? "var(--text)" : "var(--error)",
            borderColor: validity ? "var(--border)" : "var(--error)",
            fontSize: 12,
          }}
        >
          {value}
        </code>
        {!validity && (
          <span style={{ fontSize: 11, color: "var(--error)" }}>语法错误</span>
        )}
      </div>

      {showPreview && (
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
          <div>
            <span style={{ fontWeight: 600, color: "var(--text)" }}>说明:</span> {cronHumanize(value)}
          </div>
          {upcoming.length > 0 && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontFamily: "var(--font-mono)" }}>
              {upcoming.map((ts) => (
                <span key={ts}>{new Date(ts).toLocaleString()}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>
          预设
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
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Helper export for the form: turn a raw cron string into the
// 5-field shape so we can pre-populate the builder from a fresh
// task's stored cron.
export function getInitialFieldsFromCron(cron: string): [ParsedField, ParsedField, ParsedField, ParsedField, ParsedField] {
  const segments = cron.trim().split(/\s+/);
  const padded = segments.length === 5
    ? segments
    : segments.length < 5
      ? [...segments, ...Array(5 - segments.length).fill("*")]
      : segments.slice(0, 5);
  return [
    parseField(padded[0], MINUTE_MAX),
    parseField(padded[1], HOUR_MAX),
    parseField(padded[2], DOM_MAX),
    parseField(padded[3], MONTH_MAX),
    parseField(padded[4], DOW_MAX),
  ];
}

export { WEEKDAY_SHORT, WEEKDAY_LABELS };