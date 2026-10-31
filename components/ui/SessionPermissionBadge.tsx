"use client";

import { useI18n } from "@/hooks/useI18n";
import { useSessionPermission } from "@/hooks/permissionModeStore";
import {
  sessionPermissionBadge,
  type SessionPermissionMode,
} from "@/lib/shared/permission-mode";
import { ICONS } from "./icons";
import { Tooltip } from "./Tooltip";
import { AUTO_DENY_AMBER, FULL_ACCESS_RED } from "./permission-mode-colors";

interface Props {
  sessionId: string | null;
  fallbackMode?: SessionPermissionMode;
  fallbackBackground?: boolean;
}

export function SessionPermissionBadge({
  sessionId,
  fallbackMode,
  fallbackBackground,
}: Props) {
  const { t } = useI18n();
  const { permissionMode, background } = useSessionPermission(
    sessionId,
    fallbackMode,
    fallbackBackground,
  );
  const badge = sessionPermissionBadge(permissionMode, background);
  if (!badge) return null;

  const color = badge === "auto_deny" ? AUTO_DENY_AMBER : FULL_ACCESS_RED;
  const label = badge === "auto_deny"
    ? t("Auto-deny dangerous commands")
    : t("Full access to dangerous commands");
  const description = badge === "auto_deny"
    ? t("This unattended session denies dangerous commands instead of asking.")
    : t("This background session runs dangerous commands without asking.");

  return (
    <Tooltip
      content={
        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 240 }}>
          <span style={{ fontWeight: 600 }}>{label}</span>
          <span>{description}</span>
        </div>
      }
    >
      <span
        aria-label={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 15,
          height: 15,
          flexShrink: 0,
          borderRadius: 4,
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          color,
        }}
      >
        <ICONS.shield size={10} strokeWidth={2} />
      </span>
    </Tooltip>
  );
}
