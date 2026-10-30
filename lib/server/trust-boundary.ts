import { desktopModeRequested, resolveTerminalHost } from "@/lib/shared/trust-boundary";

export function isDesktopMode(): boolean {
  return desktopModeRequested(process.env);
}

export function currentTerminalHost(): string {
  return resolveTerminalHost({ desktop: isDesktopMode(), env: process.env });
}
