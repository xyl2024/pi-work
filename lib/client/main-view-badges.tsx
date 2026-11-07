"use client";

import type { ReactNode } from "react";
import { MAIN_VIEW_KINDS, type MainViewKind } from "@/lib/shared/mainView";
import { schedulerPanel } from "./scheduler-panel";
import { skillsPanel } from "./skills-panel";
import { channelsPanel } from "./channels-panel";
import { selectModelsConfigChangeCount, useModelsConfigPanel } from "./models-config-panel";
import { useSchedulerUnread } from "./scheduler-unread";
import {
  formatUnreadSegment,
  hasSchedulerUnread,
} from "@/lib/shared/scheduler-unread";

function SkillsInstallingBadge() {
  const installing = skillsPanel.useStatus() === true;
  if (!installing) return null;
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

function ModelsConfigDirtyBadge() {
  const { view } = useModelsConfigPanel();
  const count = selectModelsConfigChangeCount(view);
  if (count === 0) return null;
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        borderRadius: 999,
        background: "var(--accent)",
        color: "var(--bg)",
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {count}
    </span>
  );
}

function SchedulerBadge() {
  const running = schedulerPanel.useStatus() === true;
  const unread = useSchedulerUnread();
  const showUnread = hasSchedulerUnread(unread);
  if (!running && !showUnread) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {running && (
        <span
          aria-hidden="true"
          style={{ display: "block", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }}
        />
      )}
      {showUnread && (
        <span
          aria-label={`New scheduled task results: ${unread.success} succeeded, ${unread.failed} failed`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 16,
            borderRadius: 999,
            border: "1px solid var(--border)",
            overflow: "hidden",
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1,
            color: "var(--text-muted)",
          }}
        >
          {unread.success > 0 && (
            <span style={{ padding: "0 4px", color: "var(--text)" }}>{formatUnreadSegment(unread.success)}</span>
          )}
          {unread.success > 0 && unread.failed > 0 && (
            <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />
          )}
          {unread.failed > 0 && (
            <span style={{ padding: "0 4px", color: "var(--error)" }}>{formatUnreadSegment(unread.failed)}</span>
          )}
        </span>
      )}
    </span>
  );
}

const MAIN_VIEW_BADGE_BY_KIND: Partial<Record<MainViewKind, () => ReactNode>> = {
  scheduler: SchedulerBadge,
  skills: SkillsInstallingBadge,
  channels: ChannelsLoginBadge,
  modelsConfig: ModelsConfigDirtyBadge,
};

export function renderMainViewBadges(): Partial<Record<MainViewKind, ReactNode>> {
  const badges: Partial<Record<MainViewKind, ReactNode>> = {};
  for (const kind of MAIN_VIEW_KINDS) {
    const Badge = MAIN_VIEW_BADGE_BY_KIND[kind];
    if (Badge) badges[kind] = <Badge key={kind} />;
  }
  return badges;
}
