"use client";

// Column that owns every toggle button on the right edge of the chat
// layout. Pulled out of AppShell so the 36×36 column is a single visual
// concern — AppShell only wires the ctx. Adding a new toggle-button is
// now a one-line append to RIGHT_BAR_DESCRIPTORS in `./desc`.
//
// Layout (top → bottom):
//   1. 'fixed' descriptors with slot='top' (panel show/hide plus the
//      conditional expand/collapse toggle).
//   2. The configurable row, split by `cfg.session_bound_alignment`:
//        - "top":    session-bound group first, then global group
//                    (both groups render in document order — no spacer).
//        - "bottom": global group first, then a flex:1 spacer, then
//                    the session-bound group. The spacer pushes the
//                    session-bound group all the way to the bottom of
//                    the column regardless of how tall the chat panel
//                    is, which is what "向下对齐" means here (default).
//        - "inline": the full user-configured `order` as one list
//                    (legacy behavior, no spacer).
//      Within each group the user's `order` is honored (filtered to ids
//      in the group). Visibility per id is gated by `cfg[id] !== false`;
//      a missing key (settings not loaded yet) is treated as visible so
//      the column is never empty on first paint.
//   3. The conditional 'fixed' expand/collapse button (only when the
//      panel has tabs).
//
// There is no longer a margin-top:auto bottom-pinned group — terminal
// used to be that, but moving it to 'configurable' lets the user
// reorder/hide it through the same Settings UI as the rest.

import { Fragment, useMemo } from "react";
import {
  isRightBarButtonVisible,
  resolveSessionBoundAlignment,
  type RightSideBarConfig,
} from "@/lib/shared/right-bar";
import { RightBarButton } from "./RightBarButton";
import {
  RIGHT_BAR_BUTTON_IDS,
  RIGHT_BAR_DESCRIPTORS,
  isSessionBoundDescriptor,
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

  // Apply cfg.session_bound_alignment: partition the configurable row into
  // session-bound + global groups, then concatenate in the chosen order.
  // Within each group the user's `order` is honored (filtered to ids in
  // that group). "inline" keeps the single-list behavior used before this
  // axis was introduced. The actual *layout* (spacer or not) is handled
  // in the render path below — this hook only resolves the descriptor
  // partition.
  const { alignment, sessionBound, global } = useMemo(() => {
    const a = resolveSessionBoundAlignment(cfg?.session_bound_alignment);
    const sb: RightBarDescriptor[] = [];
    const g: RightBarDescriptor[] = [];
    for (const d of orderedDescriptors) {
      (isSessionBoundDescriptor(d) ? sb : g).push(d);
    }
    return { alignment: a, sessionBound: sb, global: g };
  }, [orderedDescriptors, cfg?.session_bound_alignment]);

  // Fixed descriptors partitioned by their slot. The top group contains
  // panel show/hide plus the conditional expand/collapse toggle; any
  // future fixed descriptor without a slot remains inline. Terminal moved
  // to the configurable row.
  const topFixed = RIGHT_BAR_DESCRIPTORS.filter(
    (d) => d.kind === "fixed" && d.slot === "top",
  );
  const inlineFixed = RIGHT_BAR_DESCRIPTORS.filter(
    (d) => d.kind === "fixed" && d.slot === undefined,
  );

  // The column sits in a row-flex parent (AppShell's main row) whose
  // default `align-items: stretch` already pulls this div to the parent's
  // height — no explicit `height: 100%` needed here. `min-height: 0` is
  // set defensively in case a future change makes the parent shrink-wrap.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        width: 36,
        minHeight: 0,
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      {/* Top: fixed panel controls (show/hide plus conditional expand). */}
      {topFixed.map((d) => renderDescriptor(d, ctx, cfg, `top-${d.id}`))}

      {/* Configurable row, laid out per session_bound_alignment.
          - "inline": single ordered list (legacy).
          - "top":    session-bound first, global second (no spacer).
          - "bottom": global first, then a flex:1 spacer that pushes
                      the session-bound group to the very bottom of the
                      column. This is the default — visually pins the
                      per-session buttons to the lower edge regardless
                      of how tall the chat panel is. */}
      {alignment === "inline" ? (
        orderedDescriptors.map((d) => renderDescriptor(d, ctx, cfg, `cfg-${d.id}`))
      ) : alignment === "top" ? (
        <Fragment>
          {sessionBound.map((d) => renderDescriptor(d, ctx, cfg, `cfg-${d.id}`))}
          {global.map((d) => renderDescriptor(d, ctx, cfg, `cfg-${d.id}`))}
        </Fragment>
      ) : (
        <Fragment>
          {global.map((d) => renderDescriptor(d, ctx, cfg, `cfg-${d.id}`))}
          {/* Spacer — absorbs every unused pixel between the global group
              and the session-bound group so the latter sits flush with
              the bottom of the column. `flex: 1` + `min-height: 0`
              guarantees it actually grows in a column-flex parent. */}
          <div style={{ flex: 1, minHeight: 0 }} aria-hidden="true" />
          {sessionBound.map((d) => renderDescriptor(d, ctx, cfg, `cfg-${d.id}`))}
        </Fragment>
      )}

      {/* Any future unslotted fixed descriptors render after the
          configurable groups. */}
      {inlineFixed.map((d) =>
        d.isVisible && !d.isVisible(ctx) ? null : renderDescriptor(d, ctx, cfg, `fixed-${d.id}`),
      )}
    </div>
  );
}

function renderDescriptor(
  desc: RightBarDescriptor,
  ctx: RightBarCtx,
  cfg: RightSideBarConfig | null,
  key: string,
): React.ReactNode {
  // Configurable descriptors are gated by cfg[id] !== false. Missing keys
  // (settings not loaded yet) → visible. Fixed descriptors always render.
  if (desc.kind === "configurable" && !isRightBarButtonVisible(cfg, desc.id)) {
    return null;
  }

  return (
    <RightBarButton
      key={key}
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
