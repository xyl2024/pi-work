export const PERMISSION_MODES = ["confirm", "full_access"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_PERMISSION_MODE: PermissionMode = "confirm";

export function flippedPermissionMode(mode: PermissionMode): PermissionMode {
  return mode === "full_access" ? "confirm" : "full_access";
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}
