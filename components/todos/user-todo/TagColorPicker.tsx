"use client";

import { useI18n } from "@/hooks/useI18n";
import { TAG_COLOR_PRESETS } from "@/lib/shared/user-todo/color-presets";

/**
 * Small popover anchored to a tag-management row's color swatch button. Lives
 * inside the manager popover's DOM tree, so the manager's click-outside handler
 * treats clicks here as "inside" and won't close the manager. The picker has
 * its own Escape handling via the manager's keydown listener (which checks
 * `colorPickerTag` first).
 */
export function TagColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="dialog"
      aria-label={t("Tag color")}
      style={{
        position: "absolute",
        top: "calc(100% + 2px)",
        right: 0,
        zIndex: 11,
        padding: 6,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
      }}
      // Stop mousedown bubbling so the manager's outside-click doesn't fire.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "0 2px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {t("Tag color")}
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 4,
      }}>
        {TAG_COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => onChange(c)}
            style={{
              width: 18, height: 18, padding: 0,
              border: value === c ? "2px solid var(--accent)" : "1px solid var(--border)",
              borderRadius: 3,
              background: c,
              cursor: "pointer",
            }}
          />
        ))}
        <label
          aria-label={t("Custom color")}
          title={t("Custom color")}
          style={{
            width: 18, height: 18,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: "1px dashed var(--border)",
            borderRadius: 3,
            cursor: "pointer",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <input
            type="color"
            value={value ?? "#000000"}
            onChange={(e) => onChange(e.target.value)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: "none",
              padding: 0,
              background: "transparent",
              cursor: "pointer",
              opacity: 0,
            }}
          />
          <span
            aria-hidden
            style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1, pointerEvents: "none" }}
          >
            ⋯
          </span>
        </label>
      </div>
      <button
        type="button"
        onClick={() => onChange(null)}
        disabled={value === null}
        style={{
          marginTop: 6,
          width: "100%",
          padding: "3px 6px",
          fontSize: 10,
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: 3,
          color: value === null ? "var(--text-dim)" : "var(--text-muted)",
          cursor: value === null ? "default" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {t("No color")}
      </button>
    </div>
  );
}