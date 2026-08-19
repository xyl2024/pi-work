"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { RIGHT_BAR_BUTTON_IDS, RIGHT_BAR_DESCRIPTOR_BY_ID } from "@/components/rightBar/desc";
import { resolveSessionBoundAlignment, type SessionBoundAlignment } from "@/lib/right-bar";
import type { PiWorkConfig, RightBarButtonId, RightSideBarConfig } from "@/lib/config";

/**
 * Section 6: Right-side buttons.
 *
 * Three sub-controls share this section, all immediate-apply via the
 * shared `apply` prop:
 *
 * - Visibility toggles (checkbox list)
 * - Button order (drag-list-style up/down buttons + Reset to default)
 * - Session-bound button alignment (top / bottom / inline radio group)
 *
 * The order list always reflects the user's override if present,
 * falling back to the descriptor registry's default — same resolver
 * logic that RightBarColumn uses to render the actual buttons.
 */
export function RightBarSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();

  // Resolve the right-bar button order: user's override takes precedence,
  // fall back to the descriptor registry's default. Filters out any id in
  // cfg.order that's no longer a known button (a removed descriptor must
  // not leave a dangling entry forever), then appends any new ids at the
  // tail so the list stays canonical without forcing a settings write.
  const resolveRightBarOrder = useCallback((
    overrides: readonly RightBarButtonId[] | undefined,
  ): RightBarButtonId[] => {
    const valid = new Set<string>(RIGHT_BAR_BUTTON_IDS);
    const out: RightBarButtonId[] = [];
    const seen = new Set<string>();
    if (overrides) {
      for (const id of overrides) {
        if (valid.has(id) && !seen.has(id)) {
          out.push(id);
          seen.add(id);
        }
      }
    }
    for (const id of RIGHT_BAR_BUTTON_IDS) {
      if (!seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    return out;
  }, []);

  const currentRightBarOrder = resolveRightBarOrder(
    config.right_side_bar.order,
  );

  const handleRightBarToggle = (id: RightBarButtonId) => {
    void apply((prev) => {
      const currentlyVisible = prev.right_side_bar[id] !== false;
      const nextRightSideBar: RightSideBarConfig = {
        ...prev.right_side_bar,
        [id]: !currentlyVisible,
      };
      return { ...prev, right_side_bar: nextRightSideBar };
    });
  };

  const handleRightBarMove = (id: RightBarButtonId, direction: "up" | "down") => {
    void apply((prev) => {
      const order = [...resolveRightBarOrder(prev.right_side_bar.order)];
      const idx = order.indexOf(id);
      if (idx === -1) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= order.length) return prev;
      [order[idx], order[target]] = [order[target], order[idx]];
      const nextRightSideBar: RightSideBarConfig = {
        ...prev.right_side_bar,
        order,
      };
      return { ...prev, right_side_bar: nextRightSideBar };
    });
  };

  // Drop `cfg.order` entirely → resolver falls back to the descriptor
  // default. We persist by omitting the field on the PUT payload, which
  // happens automatically because we don't include `order` in the new
  // right_side_bar (we `delete` only when reset is invoked, but a
  // plain omit works the same way as `JSON.stringify` doesn't emit
  // undefined keys — see below for the explicit delete).
  const handleRightBarResetOrder = () => {
    void apply((prev) => {
      const nextRightSideBar: RightSideBarConfig = { ...prev.right_side_bar };
      delete nextRightSideBar.order;
      return { ...prev, right_side_bar: nextRightSideBar };
    });
  };

  // Read the current alignment from config; falls back to "bottom" when
  // the field is missing (matches the on-disk default + parser fallback).
  const currentAlignment: SessionBoundAlignment =
    resolveSessionBoundAlignment(config.right_side_bar.session_bound_alignment);

  const handleRightBarAlignmentChange = (next: SessionBoundAlignment) => {
    void apply((prev) => {
      if (resolveSessionBoundAlignment(prev.right_side_bar.session_bound_alignment) === next) {
        return prev; // no-op (avoid spurious PUT)
      }
      const nextRightSideBar: RightSideBarConfig = {
        ...prev.right_side_bar,
        session_bound_alignment: next,
      };
      return { ...prev, right_side_bar: nextRightSideBar };
    });
  };

  return (
    <div data-settings-section="settings-section-right-bar" style={{ marginBottom: 24, marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("Right-side buttons")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
        {t("Choose which buttons appear in the right-side bar. Hidden buttons can still be opened from the command palette. Changes apply immediately.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {currentRightBarOrder.map((id) => {
          const labelKey = RIGHT_BAR_DESCRIPTOR_BY_ID.get(id)?.labelKey ?? "";
          const checked = config.right_side_bar[id] !== false;
          return (
            <label
              key={id}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handleRightBarToggle(id)}
                style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }}
              />
              <span>{t(labelKey)}</span>
            </label>
          );
        })}
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: 0 }}>
            {t("Button order")}
          </h4>
          {config.right_side_bar.order !== undefined && (
            <button
              type="button"
              onClick={handleRightBarResetOrder}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t("Reset to default")}
            </button>
          )}
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
          {t("Reorder the buttons shown in the right-side bar. Up / Down buttons swap adjacent entries; the result is saved immediately.")}
        </p>
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {currentRightBarOrder.map((id, idx) => {
            const labelKey = RIGHT_BAR_DESCRIPTOR_BY_ID.get(id)?.labelKey ?? "";
            const isFirst = idx === 0;
            const isLast = idx === currentRightBarOrder.length - 1;
            return (
              <li
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                <span style={{ minWidth: 20, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "right" }}>
                  {idx + 1}
                </span>
                <span style={{ flex: 1 }}>{t(labelKey)}</span>
                <button
                  type="button"
                  onClick={() => handleRightBarMove(id, "up")}
                  disabled={isFirst}
                  aria-label={t("Move up")}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                    padding: "2px 8px",
                    color: isFirst ? "var(--text-dim)" : "var(--text-muted)",
                    cursor: isFirst ? "not-allowed" : "pointer",
                    opacity: isFirst ? 0.5 : 1,
                    fontSize: 11,
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => handleRightBarMove(id, "down")}
                  disabled={isLast}
                  aria-label={t("Move down")}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                    padding: "2px 8px",
                    color: isLast ? "var(--text-dim)" : "var(--text-muted)",
                    cursor: isLast ? "not-allowed" : "pointer",
                    opacity: isLast ? 0.5 : 1,
                    fontSize: 11,
                  }}
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Session-bound button vertical alignment — new axis on top of
          the existing `order` field. Three radio options; the UI is
          intentionally a single row so the user can compare them
          side-by-side without scrolling. Within each group the user's
          `order` still applies (filtered to the group). Defaults to
          "bottom" on disk; the resolver in RightBarColumn mirrors this
          fallback so the column is never misaligned before the
          settings fetch resolves. */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: 0 }}>
            {t("Session-bound button alignment")}
          </h4>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
          {t("Where session-bound buttons sit in the right-side bar. Session-bound buttons (Context, Tool Calls, Conversation Tree, Git Diff, LLM API audit) read from the active session and become empty on the new-session page.")}
        </p>
        <div role="radiogroup" aria-label={t("Session-bound button alignment")} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {([
            { value: "top" as const,    labelKey: "Align session-bound buttons to the top" },
            { value: "bottom" as const, labelKey: "Align session-bound buttons to the bottom (default)" },
            { value: "inline" as const, labelKey: "Inline with button order (legacy)" },
          ]).map((opt) => {
            const checked = currentAlignment === opt.value;
            return (
              <label
                key={opt.value}
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}
              >
                <input
                  type="radio"
                  name="right-bar-session-bound-alignment"
                  value={opt.value}
                  checked={checked}
                  onChange={() => handleRightBarAlignmentChange(opt.value)}
                  style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <span>{t(opt.labelKey)}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}