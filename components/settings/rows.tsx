"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * One row in the "File preview limits" section. The row owns a local
 * `draft` string so the user can type freely (including transient
 * invalid states like empty / decimal) without losing focus; on blur or
 * Enter we parse + range-check, and on success we call `onCommit(next)`
 * which the section wires to a settings-store write. Invalid input never
 * reaches the PUT — the row rolls the draft back to the last accepted
 * value and shows a short inline error in the theme's danger color.
 */
export function FileViewerLimitRow({
  label,
  min,
  max,
  value,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onCommit: (next: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string>(String(value));
  const [error, setError] = useState<string | null>(null);

  // Re-sync the draft when the authoritative value changes (e.g. PUT
  // succeeded and settingsStore emitted, or rollback on PUT failure).
  // Skipping the sync while the input is in an error state would let
  // the rolled-back draft survive — always mirror the prop so the row
  // tells the truth about what's on disk.
  useEffect(() => {
    setDraft(String(value));
    setError(null);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError(t("Value must not be empty"));
      setDraft(String(value));
      return;
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
      setError(t("Must be between {min} and {max}", { min, max }));
      setDraft(String(value));
      return;
    }
    setError(null);
    if (num !== value) onCommit(num);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 4px 0" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="number"
          min={min}
          max={max}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // Clear the error as soon as the user starts editing again,
            // so the red border doesn't linger on an in-progress fix.
            if (error) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          aria-invalid={error ? "true" : undefined}
          style={{
            width: 80,
            height: 30,
            padding: "4px 8px",
            background: "var(--bg-panel)",
            border: `1px solid ${error ? "#ef4444" : "var(--border)"}`,
            borderRadius: 6,
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>MB</span>
        {error && (
          <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
        {t("Range: {min}–{max} MB", { min, max })}
      </div>
    </div>
  );
}

/**
 * One row in the Agent retry section. Like `FileViewerLimitRow`, the
 * row owns a local `draft` string so the user can type freely
 * (including transient invalid states like empty / decimal) without
 * losing focus; on blur or Enter we parse + range-check, and on
 * success we call `onCommit(next | null)` which the section wires to
 * a PUT.
 *
 * Difference vs FileViewerLimitRow: this row supports an "optional"
 * flag. For the provider-level fields (`timeoutMs`, `maxRetries`,
 * `maxRetryDelayMs`), an empty draft means "use the SDK default" —
 * the row commits `null` instead of a number, and the section's
 * `onCommit` handler passes `null` through to the API which omits the
 * field from the JSON it writes. `placeholder` is what the empty
 * draft shows (e.g. "SDK default" / "0" / "60000") so the user knows
 * what the default will be.
 */
export function RetryNumberRow({
  label,
  min,
  max,
  value,            // number | null
  placeholder,
  optional,
  unitSuffix,
  onCommit,         // (next: number | null) => void
}: {
  label: string;
  min: number;
  max: number;
  value: number | null;
  placeholder: string;
  optional: boolean;
  unitSuffix?: string;
  onCommit: (next: number | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string>(value === null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);

  // Re-sync the draft whenever the authoritative value changes (PUT
  // succeeded and the section re-fetched, or rollback on PUT failure).
  useEffect(() => {
    setDraft(value === null ? "" : String(value));
    setError(null);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (optional) {
        // Empty + optional → "use default". Commit null only if the
        // current value isn't already null, otherwise no-op.
        if (value !== null) onCommit(null);
        setError(null);
        return;
      }
      setError(t("Value must not be empty"));
      setDraft(value === null ? "" : String(value));
      return;
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
      setError(t("Must be between {min} and {max}", { min, max }));
      setDraft(value === null ? "" : String(value));
      return;
    }
    setError(null);
    if (value === null || num !== value) onCommit(num);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 4px 0" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="number"
          min={min}
          max={max}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          aria-invalid={error ? "true" : undefined}
          style={{
            width: 100,
            height: 30,
            padding: "4px 8px",
            background: "var(--bg-panel)",
            border: `1px solid ${error ? "#ef4444" : "var(--border)"}`,
            borderRadius: 6,
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
          }}
        />
        {unitSuffix && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{unitSuffix}</span>
        )}
        {error && (
          <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
        {optional
          ? t("Range: {min}–{max} (empty = use SDK default)", { min, max })
          : t("Range: {min}–{max}", { min, max })}
      </div>
    </div>
  );
}