"use client";

import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";

interface NumericFieldProps {
  value: number | null;
  onCommit: (value: number | null) => void;
  min: number;
  max: number;
  label?: string;
  placeholder?: string;
  unit?: string;
  hint?: string;
  emptyHint?: string;
  rangeError?: string;
  optional?: boolean;
  width?: number;
  step?: number;
  integer?: boolean;
  ariaLabel?: string;
}

/**
 * Styled integer setting field with deferred validation.
 *
 * Unlike NumberStepper, this component keeps a draft while editing and only
 * commits on blur/Enter. Invalid values roll back to the last accepted value,
 * which makes it suitable for settings backed by an API.
 */
export function NumericField({
  value,
  onCommit,
  min,
  max,
  label,
  placeholder,
  unit,
  hint,
  emptyHint,
  rangeError,
  optional = false,
  width = 112,
  step = 1,
  integer = true,
  ariaLabel,
}: NumericFieldProps) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setDraft(value == null ? "" : String(value));
    setError(null);
  }, [value]);

  const reset = () => {
    setDraft(value == null ? "" : String(value));
    setError(null);
  };
  const restoreDraft = () => {
    setDraft(value == null ? "" : String(value));
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (optional) {
        setError(null);
        if (value !== null) onCommit(null);
      } else {
        setError(emptyHint ?? "Value must not be empty");
        restoreDraft();
      }
      return;
    }

    const next = Number(trimmed);
    if (!Number.isFinite(next) || (integer && !Number.isInteger(next)) || next < min || next > max) {
      setError(rangeError ?? `Must be between ${min} and ${max}`);
      restoreDraft();
      return;
    }

    setError(null);
    if (value !== next) onCommit(next);
  };

  const changeBy = (delta: number) => {
    const current = Number(draft);
    const base = Number.isInteger(current) ? current : (value ?? min);
    const next = Math.max(min, Math.min(max, base + delta));
    const normalized = integer ? Math.round(next) : next;
    setDraft(String(normalized));
    setError(null);
    if (normalized !== value) onCommit(normalized);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      reset();
      event.currentTarget.blur();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      changeBy(step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      changeBy(-step);
    }
  };

  const atMin = value !== null && Number.isInteger(value) && value <= min;
  const atMax = value !== null && Number.isInteger(value) && value >= max;
  const inputStyle: CSSProperties = {
    width,
    height: 32,
    padding: "4px 9px",
    border: `1px solid ${error ? "var(--error)" : focused ? "var(--accent)" : "var(--border)"}`,
    borderRadius: 6,
    background: "var(--bg-panel)",
    color: "var(--text)",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
    textAlign: "left",
    boxShadow: focused ? "0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent)" : "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {label && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32 }}>
        <div style={{ display: "inline-flex", alignItems: "stretch", width: "fit-content", flexShrink: 0 }}>
          <button type="button" disabled={atMin} onClick={() => changeBy(-step)} aria-label={`${ariaLabel ?? label ?? "Value"} decrease`} style={stepButtonStyle("left", atMin)}>
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            value={draft}
            placeholder={placeholder}
            aria-label={ariaLabel ?? label}
            aria-invalid={error ? "true" : undefined}
            onChange={(event) => {
              const pattern = integer ? /[^\d]/g : /[^\d.]/g;
              setDraft(event.target.value.replace(pattern, ""));
              setError(null);
            }}
            onBlur={() => { setFocused(false); commit(); }}
            onFocus={(event) => { setFocused(true); event.currentTarget.select(); }}
            onKeyDown={onKeyDown}
            style={inputStyle}
          />
          <button type="button" disabled={atMax} onClick={() => changeBy(step)} aria-label={`${ariaLabel ?? label ?? "Value"} increase`} style={stepButtonStyle("right", atMax)}>
            +
          </button>
        </div>
        {unit && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{unit}</span>}
        {error && <span style={{ fontSize: 11, color: "var(--error)" }}>{error}</span>}
      </div>
      {(hint || (optional && emptyHint)) && (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{hint ?? emptyHint}</div>
      )}
    </div>
  );
}

function stepButtonStyle(side: "left" | "right", disabled: boolean): CSSProperties {
  return {
    width: 28,
    minWidth: 28,
    height: 32,
    padding: 0,
    border: "1px solid var(--border)",
    borderRight: side === "left" ? "none" : "1px solid var(--border)",
    borderLeft: side === "right" ? "none" : "1px solid var(--border)",
    borderRadius: side === "left" ? "6px 0 0 6px" : "0 6px 6px 0",
    background: "var(--bg-panel)",
    color: disabled ? "var(--text-dim)" : "var(--text-muted)",
    cursor: disabled ? "default" : "pointer",
    fontSize: 18,
    lineHeight: 1,
  };
}
