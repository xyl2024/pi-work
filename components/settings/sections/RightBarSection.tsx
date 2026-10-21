"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SecondaryButton } from "../controls";
import { RIGHT_BAR_BUTTON_IDS, RIGHT_BAR_DESCRIPTOR_BY_ID } from "@/components/panels/right-bar/desc";
import {
  resolveSessionBoundAlignment,
  type RightBarButtonId,
  type RightSideBarConfig,
  type SessionBoundAlignment,
} from "@/lib/shared/right-bar";
import type { PiWorkConfig } from "@/lib/shared/config-types";

/**
 * Section 6: Right-side buttons.
 *
 * Two sub-controls share this section, all immediate-apply via the
 * shared `apply` prop:
 *
 * - Button list: one row per button carrying its glyph, its visibility
 *   toggle (Enable / Disable) and its up/down order buttons, plus Reset
 *   to defaults in the header. The list is split into the same groups the
 *   live column stacks — session-bound vs. other — ordered top to bottom
 *   per `session_bound_alignment`, so ↑/↓ never swaps across a group
 *   boundary (which would be invisible in the column).
 * - Session-bound button alignment (top / bottom / inline radio group)
 *
 * Visibility and order share one list on purpose: the toggle sits on the
 * row it belongs to, so "which buttons exist" and "in what order" are
 * never answered by two separate lists the user has to cross-read.
 *
 * The list always reflects the user's override if present, falling back
 * to the descriptor registry's default — same resolver logic that
 * RightBarColumn uses to render the actual buttons.
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

  // Swap one entry with its neighbour inside `list`. Returns false when
  // the move would leave the list (the caller then skips the write).
  const swapAdjacent = (
    list: RightBarButtonId[],
    id: RightBarButtonId,
    direction: "up" | "down",
  ): boolean => {
    const idx = list.indexOf(id);
    if (idx === -1) return false;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= list.length) return false;
    [list[idx], list[target]] = [list[target], list[idx]];
    return true;
  };

  /**
   * Move a button one step up/down.
   *
   * `group` says which list the row belongs to: `true` = session-bound,
   * `false` = global, `null` = the flat legacy ("inline") list. Moving is
   * always confined to that list — the column never interleaves the two
   * groups in top/bottom alignment, so a cross-group swap would be a
   * no-op on screen. The persisted `order` is rebuilt as
   * `[top group, bottom group]` for the current alignment; the column
   * re-filters per group anyway, so only within-group order matters.
   */
  const handleRightBarMove = (
    id: RightBarButtonId,
    direction: "up" | "down",
    group: boolean | null,
  ) => {
    void apply((prev) => {
      const order = [...resolveRightBarOrder(prev.right_side_bar.order)];
      const isSessionBoundId = (candidate: RightBarButtonId) =>
        RIGHT_BAR_DESCRIPTOR_BY_ID.get(candidate)?.sessionBound === true;
      if (group === null) {
        if (!swapAdjacent(order, id, direction)) return prev;
      } else {
        const sessionBound = order.filter(isSessionBoundId);
        const global = order.filter((candidate) => !isSessionBoundId(candidate));
        if (!swapAdjacent(group ? sessionBound : global, id, direction)) return prev;
        const alignment = resolveSessionBoundAlignment(
          prev.right_side_bar.session_bound_alignment,
        );
        order.length = 0;
        order.push(
          ...(alignment === "top"
            ? [...sessionBound, ...global]
            : [...global, ...sessionBound]),
        );
      }
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

  // ── order groups ────────────────────────────────────────────────
  // The live column partitions the configurable buttons into a
  // session-bound group and a global group, then stacks them per
  // `session_bound_alignment`. The order list mirrors that partition —
  // otherwise an ↑/↓ inside one group would swap ids across the group
  // boundary and visibly do nothing in the column. "inline" is the
  // legacy single-list mode, so it keeps one flat list here too.
  const isSessionBoundId = (id: RightBarButtonId) =>
    RIGHT_BAR_DESCRIPTOR_BY_ID.get(id)?.sessionBound === true;
  const sessionBoundIds = currentRightBarOrder.filter(isSessionBoundId);
  const globalIds = currentRightBarOrder.filter((id) => !isSessionBoundId(id));
  const orderGroups: { key: string; sessionBound: boolean | null; ids: RightBarButtonId[] }[] =
    currentAlignment === "inline"
      ? [{ key: "inline", sessionBound: null, ids: currentRightBarOrder }]
      : currentAlignment === "top"
        ? [
            { key: "sessionBound", sessionBound: true, ids: sessionBoundIds },
            { key: "global", sessionBound: false, ids: globalIds },
          ]
        : [
            { key: "global", sessionBound: false, ids: globalIds },
            { key: "sessionBound", sessionBound: true, ids: sessionBoundIds },
          ];

  return (
    <>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: 0 }}>
            {t("Button order")}
          </h4>
          {config.right_side_bar.order !== undefined && (
            <SecondaryButton
              onClick={handleRightBarResetOrder}
              style={{ height: 26, padding: "4px 10px" }}
            >
              {t("Reset to defaults")}
            </SecondaryButton>
          )}
        </div>
        {orderGroups.map((group, groupIdx) => (
          <div key={group.key} style={{ marginTop: groupIdx === 0 ? 0 : 14 }}>
            {/* Group caption: which buttons these are, and where the
                group sits in the column. Groups render in column order
                (top group first), matching what the column shows. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              <span style={{ fontWeight: 600 }}>
                {group.sessionBound === null
                  ? t("All buttons")
                  : group.sessionBound
                    ? t("Session-bound buttons")
                    : t("Other buttons")}
              </span>
              {group.sessionBound !== null && (
                <span>
                  · {t(groupIdx === 0 ? "top section" : "bottom section")}
                </span>
              )}
            </div>
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {group.ids.map((id, idx) => {
                const descriptor = RIGHT_BAR_DESCRIPTOR_BY_ID.get(id);
                const labelKey = descriptor?.labelKey ?? "";
                const enabled = config.right_side_bar[id] !== false;
                const isFirst = idx === 0;
                const isLast = idx === group.ids.length - 1;
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
                    {/* Same glyph the button column renders, so the row is
                        recognisable without reading the label. */}
                    <span
                      aria-hidden="true"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        flexShrink: 0,
                        color: enabled ? "var(--text)" : "var(--text-dim)",
                      }}
                    >
                      {descriptor?.icon({ size: 14, active: false })}
                    </span>
                    <span style={{ flex: 1, color: enabled ? "var(--text)" : "var(--text-dim)" }}>
                      {t(labelKey)}
                    </span>
                    <SecondaryButton
                      onClick={() => handleRightBarToggle(id)}
                      style={{ height: 24, padding: "2px 10px", fontSize: 11 }}
                    >
                      {enabled ? t("Disable button") : t("Enable button")}
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={() => handleRightBarMove(id, "up", group.sessionBound)}
                      disabled={isFirst}
                      ariaLabel={t("Move up")}
                      style={{ height: 24, minWidth: 28, padding: "2px 8px", fontSize: 11 }}
                    >
                      ↑
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={() => handleRightBarMove(id, "down", group.sessionBound)}
                      disabled={isLast}
                      ariaLabel={t("Move down")}
                      style={{ height: 24, minWidth: 28, padding: "2px 8px", fontSize: 11 }}
                    >
                      ↓
                    </SecondaryButton>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      {/* Session-bound button vertical alignment — new axis on top of
          the existing `order` field. Three radio options; the order list
          above re-groups itself the moment this changes so the user sees
          the resulting stacking order directly. Within each group the
          user's `order` still applies (filtered to the group). Defaults
          to "bottom" on disk; the resolver in RightBarColumn mirrors
          this fallback so the column is never misaligned before the
          settings fetch resolves. */}
      <div style={{ marginTop: 20, paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: 0 }}>
            {t("Session-bound button alignment")}
          </h4>
        </div>
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
    </>
  );
}