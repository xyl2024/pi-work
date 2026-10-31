export const PERMISSION_MODES = ["confirm", "full_access"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const BACKGROUND_PERMISSION_MODES = ["full_access", "auto_deny"] as const;

export type BackgroundPermissionMode = (typeof BACKGROUND_PERMISSION_MODES)[number];

export type SessionPermissionMode = PermissionMode | BackgroundPermissionMode;

export const DEFAULT_PERMISSION_MODE: PermissionMode = "confirm";

export const DEFAULT_BACKGROUND_PERMISSION_MODE: BackgroundPermissionMode = "auto_deny";

export function flippedPermissionMode(mode: PermissionMode): PermissionMode {
  return mode === "full_access" ? "confirm" : "full_access";
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

export function isBackgroundPermissionMode(value: unknown): value is BackgroundPermissionMode {
  return (
    typeof value === "string" &&
    (BACKGROUND_PERMISSION_MODES as readonly string[]).includes(value)
  );
}

export function isSessionPermissionMode(value: unknown): value is SessionPermissionMode {
  return isPermissionMode(value) || isBackgroundPermissionMode(value);
}

export function resolveBackgroundPermissionMode(value: unknown): BackgroundPermissionMode {
  return isBackgroundPermissionMode(value) ? value : DEFAULT_BACKGROUND_PERMISSION_MODE;
}

export function isBackgroundSessionSource(source: string): boolean {
  return source === "scheduled" || source === "subagent";
}

export function canSwitchSessionPermissionMode(
  mode: SessionPermissionMode,
  background: boolean,
): boolean {
  return !background && isPermissionMode(mode);
}

export type SessionPermissionBadgeKind = "auto_deny" | "full_access";

export function sessionPermissionBadge(
  mode: SessionPermissionMode,
  background: boolean,
): SessionPermissionBadgeKind | null {
  if (mode === "auto_deny") return "auto_deny";
  if (background && mode === "full_access") return "full_access";
  return null;
}
