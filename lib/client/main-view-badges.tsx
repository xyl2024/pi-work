"use client";

import type { ReactNode } from "react";
import { MAIN_VIEW_KINDS, type MainViewKind } from "@/lib/shared/mainView";
import { schedulerPanel } from "./scheduler-panel";
import { channelsPanel } from "./channels-panel";

function SchedulerRunningBadge() {
  const running = schedulerPanel.useStatus() === true;
  if (!running) return null;
  return (
    <span
      aria-hidden="true"
      style={{ display: "block", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }}
    />
  );
}

function ChannelsLoginBadge() {
  const loggingIn = channelsPanel.useStatus() === true;
  if (!loggingIn) return null;
  return (
    <span
      aria-hidden="true"
      style={{ display: "block", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }}
    />
  );
}

const MAIN_VIEW_BADGE_BY_KIND: Partial<Record<MainViewKind, () => ReactNode>> = {
  scheduler: SchedulerRunningBadge,
  channels: ChannelsLoginBadge,
};

export function renderMainViewBadges(): Partial<Record<MainViewKind, ReactNode>> {
  const badges: Partial<Record<MainViewKind, ReactNode>> = {};
  for (const kind of MAIN_VIEW_KINDS) {
    const Badge = MAIN_VIEW_BADGE_BY_KIND[kind];
    if (Badge) badges[kind] = <Badge key={kind} />;
  }
  return badges;
}
