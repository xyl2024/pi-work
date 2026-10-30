"use client";

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

  const orderedDescriptors = useMemo(() => {
    return orderedConfigurable
      .map((id) => RIGHT_BAR_DESCRIPTORS.find((d) => d.id === id))
      .filter((d): d is RightBarDescriptor => d !== undefined);
  }, [orderedConfigurable]);

  const { alignment, sessionBound, global } = useMemo(() => {
    const a = resolveSessionBoundAlignment(cfg?.session_bound_alignment);
    const sb: RightBarDescriptor[] = [];
    const g: RightBarDescriptor[] = [];
    for (const d of orderedDescriptors) {
      (isSessionBoundDescriptor(d) ? sb : g).push(d);
    }
    return { alignment: a, sessionBound: sb, global: g };
  }, [orderedDescriptors, cfg?.session_bound_alignment]);

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
        minHeight: 0,
        background: "var(--bg-panel)",
        border: "1px solid var(--panel-border)",
        borderRadius: "var(--panel-radius)",
        overflow: "hidden",
        marginLeft: "var(--panel-gap)",
      }}
    >
      {topFixed.map((d) => renderDescriptor(d, ctx, cfg, `top-${d.id}`))}

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
          <div style={{ flex: 1, minHeight: 0 }} aria-hidden="true" />
          {sessionBound.map((d) => renderDescriptor(d, ctx, cfg, `cfg-${d.id}`))}
        </Fragment>
      )}

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
      icon={desc.icon({ size: 16, active: desc.isActive(ctx) })}
    />
  );
}
