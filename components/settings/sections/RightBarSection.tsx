"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SecondaryButton } from "../controls";
import { SettingsGroup, SettingsRow } from "../rows";
import { IconButton } from "@/components/ui/IconButton";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { RIGHT_BAR_BUTTON_IDS, RIGHT_BAR_DESCRIPTOR_BY_ID } from "@/components/panels/right-bar/desc";
import {
  resolveSessionBoundAlignment,
  type RightBarButtonId,
  type RightSideBarConfig,
  type SessionBoundAlignment,
} from "@/lib/shared/right-bar";
import type { PiWorkConfig } from "@/lib/shared/config-types";

export function RightBarSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();

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

  const handleRightBarResetOrder = () => {
    void apply((prev) => {
      const nextRightSideBar: RightSideBarConfig = { ...prev.right_side_bar };
      delete nextRightSideBar.order;
      return { ...prev, right_side_bar: nextRightSideBar };
    });
  };

  const currentAlignment: SessionBoundAlignment =
    resolveSessionBoundAlignment(config.right_side_bar.session_bound_alignment);

  const handleRightBarAlignmentChange = (next: SessionBoundAlignment) => {
    void apply((prev) => {
      if (resolveSessionBoundAlignment(prev.right_side_bar.session_bound_alignment) === next) {
        return prev;
      }
      const nextRightSideBar: RightSideBarConfig = {
        ...prev.right_side_bar,
        session_bound_alignment: next,
      };
      return { ...prev, right_side_bar: nextRightSideBar };
    });
  };

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
      <SettingsGroup
        action={config.right_side_bar.order !== undefined
          ? (
            <SecondaryButton onClick={handleRightBarResetOrder}>
              {t("Reset to defaults")}
            </SecondaryButton>
          )
          : undefined}
      >
        {orderGroups.map((group, groupIdx) => (
          <div key={group.key}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                paddingTop: groupIdx === 0 ? 8 : 18,
                paddingBottom: 2,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
              }}
            >
              <span>
                {group.sessionBound === null
                  ? t("All buttons")
                  : group.sessionBound
                    ? t("Session-bound buttons")
                    : t("Other buttons")}
              </span>
              {group.sessionBound !== null && (
                <span style={{ fontWeight: 500, letterSpacing: 0 }}>
                  · {t(groupIdx === 0 ? "top section" : "bottom section")}
                </span>
              )}
            </div>
            {group.ids.map((id, idx) => {
              const descriptor = RIGHT_BAR_DESCRIPTOR_BY_ID.get(id);
              const labelKey = descriptor?.labelKey ?? "";
              const enabled = config.right_side_bar[id] !== false;
              const isFirst = idx === 0;
              const isLast = idx === group.ids.length - 1;
              return (
                <SettingsRow
                  key={id}
                  title={(
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          color: enabled ? "var(--text-muted)" : "var(--text-dim)",
                        }}
                      >
                        {descriptor?.icon({ size: 14, active: false })}
                      </span>
                      <span style={{ color: enabled ? "var(--text)" : "var(--text-dim)" }}>
                        {t(labelKey)}
                      </span>
                    </span>
                  )}
                >
                  <ToggleSwitch
                    size="sm"
                    on={enabled}
                    onChange={() => handleRightBarToggle(id)}
                    label={enabled ? t("Disable button") : t("Enable button")}
                  />
                  <IconButton
                    label={t("Move up")}
                    onClick={() => handleRightBarMove(id, "up", group.sessionBound)}
                    disabled={isFirst}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label={t("Move down")}
                    onClick={() => handleRightBarMove(id, "down", group.sessionBound)}
                    disabled={isLast}
                  >
                    ↓
                  </IconButton>
                </SettingsRow>
              );
            })}
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup title={t("Session-bound button alignment")}>
        {([
          { value: "top" as const,    labelKey: "Align session-bound buttons to the top" },
          { value: "bottom" as const, labelKey: "Align session-bound buttons to the bottom (default)" },
          { value: "inline" as const, labelKey: "Inline with button order (legacy)" },
        ]).map((opt) => {
          const checked = currentAlignment === opt.value;
          return (
            <SettingsRow
              key={opt.value}
              title={t(opt.labelKey)}
            >
              <input
                type="radio"
                name="right-bar-session-bound-alignment"
                value={opt.value}
                checked={checked}
                onChange={() => handleRightBarAlignmentChange(opt.value)}
                aria-label={t(opt.labelKey)}
                style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }}
              />
            </SettingsRow>
          );
        })}
      </SettingsGroup>
    </>
  );
}
