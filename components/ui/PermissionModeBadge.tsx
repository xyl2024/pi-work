"use client";

import { useI18n } from "@/hooks/useI18n";
import { useSessionPermissionMode } from "@/hooks/permissionModeStore";
import type { PermissionMode } from "@/lib/shared/permission-mode";
import { ICONS } from "./icons";
import { Tooltip } from "./Tooltip";
import { FULL_ACCESS_RED } from "./permission-mode-colors";

/**
 * The red shield a session wears while it is in full access (ADR-0021).
 *
 * Two properties matter and both are deliberate:
 *
 *   • It renders nothing at all on `confirm`. A permanent "you are safe" badge
 *     would turn the signal into wallpaper.
 *   • It reads the mode from the cross-session store, falling back to what the
 *     session list reported from disk. That is what makes the badge appear on a
 *     session nobody has opened yet — persistence plus "nobody remembers" would
 *     be a permanently open gate.
 */
export function PermissionModeBadge({
  sessionId,
  fallback = "confirm",
  size = 12,
}: {
  sessionId: string | null;
  /** The mode the session list reported for this row (`SessionInfo`). */
  fallback?: PermissionMode;
  size?: number;
}) {
  const { t } = useI18n();
  const mode = useSessionPermissionMode(sessionId, fallback);
  if (mode !== "full_access") return null;
  return (
    <Tooltip content={t("This session is in full access")}>
      <span
        aria-label={t("Allow full access")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          color: FULL_ACCESS_RED,
        }}
      >
        <ICONS.shield size={size} strokeWidth={2.2} />
      </span>
    </Tooltip>
  );
}
