"use client";

// Column that owns every toggle button on the right edge of the chat
// layout. Pulled out of AppShell so the 36×36 column is a single visual
// concern — AppShell only wires the ctx. Adding a new toggle-button is
// now a one-line append to RIGHT_BAR_DESCRIPTORS in `./desc`.
//
// Layout (top → bottom):
//   1. 'fixed' descriptors with slot='top' (currently just the panel
//      show/hide toggle — always visible).
//   2. 'configurable' descriptors in the user's chosen order (includes
//      terminal — it's a normal toggle-button now, hidden-able and
//      reorderable through Settings). Visibility gates them through
//      `cfg[id] !== false`; a missing key (settings not loaded yet) is
//      treated as visible so the column is never empty on first paint.
//   3. The conditional 'fixed' expand/collapse button (only when the
//      panel has tabs).
//
// There is no longer a margin-top:auto bottom-pinned group — terminal
// used to be that, but moving it to 'configurable' lets the user
// reorder/hide it through the same Settings UI as the rest.

import { useMemo } from "react";
import { isRightBarButtonVisible, type RightSideBarConfig } from "@/lib/right-bar";
import { RightBarButton } from "./RightBarButton";
import {
  RIGHT_BAR_BUTTON_IDS,
  RIGHT_BAR_DESCRIPTORS,
  resolveButtonLabel,
  type RightBarCtx,
  type RightBarDescriptor,
} from "./desc";

interface RightBarColumnProps {
  cfg: RightSideBarConfig | null;
  ctx: RightBarCtx;
}

export function RightBarColumn({ cfg, ctx }: RightBarColumnProps) {
  // Resolve the user-configured order, filtering stale/missing ids and
  // appending any new ones at the tail. Same algorithm as SettingsModal
  // so the modal list and the live column always agree.
  const orderedConfigurable = useMemo<typeof RIGHT_BAR_BUTTON_IDS[number][]>(() => {
    const overrides = cfg?.order;
    const valid = new Set<string>(RIGHT_BAR_BUTTON_IDS);
    const out: typeof RIGHT_BAR_BUTTON_IDS[number][] = [];
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
  }, [cfg?.order]);

  // Map ordered ids back to descriptors. Every id in RIGHT_BAR_BUTTON_IDS
  // corresponds to a 'configurable' descriptor in RIGHT_BAR_DESCRIPTORS,
  // so the filter is just defensive — a stale registry entry never breaks
  // the column.
  const orderedDescriptors = useMemo(() => {
    return orderedConfigurable
      .map((id) => RIGHT_BAR_DESCRIPTORS.find((d) => d.id === id))
      .filter((d): d is RightBarDescriptor => d !== undefined);
  }, [orderedConfigurable]);

  // Fixed descriptors partitioned by their slot. Only 'top' (panel
  // show/hide) and inline/'undefined' (expand/collapse, conditional)
  // remain — terminal moved to the configurable row.
  const topFixed = RIGHT_BAR_DESCRIPTORS.filter(
    (d) => d.kind === "fixed" && d.slot === "top",
  );
  const inlineFixed = RIGHT_BAR_DESCRIPTORS.filter(
    (d) => d.kind === "fixed" && d.slot === undefined,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        width: 36,
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      {/* Top: always-visible fixed buttons (panel show/hide today). */}
      {topFixed.map((d) => renderDescriptor(d, ctx, cfg))}

      {/* Configurable row, user-ordered. Includes terminal — it's no
          longer pinned to the bottom of the column. */}
      {orderedDescriptors.map((d) => renderDescriptor(d, ctx, cfg))}

      {/* Inline fixed (expand/collapse), conditional — rendered after
          the user-ordered list so it sits just below it. */}
      {inlineFixed.map((d) =>
        d.isVisible && !d.isVisible(ctx) ? null : renderDescriptor(d, ctx, cfg),
      )}
    </div>
  );
}

function renderDescriptor(
  desc: RightBarDescriptor,
  ctx: RightBarCtx,
  cfg: RightSideBarConfig | null,
): React.ReactNode {
  // Configurable descriptors are gated by cfg[id] !== false. Missing keys
  // (settings not loaded yet) → visible. Fixed descriptors always render.
  if (desc.kind === "configurable" && !isRightBarButtonVisible(cfg, desc.id)) {
    return null;
  }

  return (
    <RightBarButton
      label={resolveButtonLabel(desc, ctx)}
      onClick={() => desc.onClick(ctx)}
      active={desc.isActive(ctx)}
      disabled={desc.isDisabled ? desc.isDisabled(ctx) : false}
      badge={desc.badge?.(ctx) ?? undefined}
      flexDirection={desc.bodyLayout?.flexDirection ?? "row"}
      gap={desc.bodyLayout?.gap}
    >
      {desc.content(ctx)}
    </RightBarButton>
  );
}
