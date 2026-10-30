import type { RightBarButtonId } from "./panelTabs";

export type { RightBarButtonId };

export type SessionBoundAlignment = "top" | "bottom" | "inline";

export interface RightSideBarConfig {
  [key: string]: boolean | readonly RightBarButtonId[] | SessionBoundAlignment | undefined;
  order?: readonly RightBarButtonId[];
  session_bound_alignment?: SessionBoundAlignment;
}

export function resolveSessionBoundAlignment(
  raw: unknown,
): SessionBoundAlignment {
  return raw === "top" || raw === "inline" ? raw : "bottom";
}

export function isRightBarButtonVisible(
  cfg: RightSideBarConfig | null,
  id: string,
): boolean {
  if (cfg === null) return true;
  return (cfg as Record<string, unknown>)[id] !== false;
}
