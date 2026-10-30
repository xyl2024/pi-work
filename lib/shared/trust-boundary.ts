export const LOOPBACK_HOST = "127.0.0.1";

const FALSY_FLAGS = new Set(["0", "false", "no", "off"]);

export function desktopModeRequested(env: Record<string, string | undefined>): boolean {
  const value = env.PI_WORK_DESKTOP?.trim().toLowerCase();
  if (!value) return false;
  return !FALSY_FLAGS.has(value);
}

export function authDisabledRequested(env: Record<string, string | undefined>): boolean {
  return ["1", "true", "yes", "on"].includes(env.PI_WORK_AUTH_DISABLED?.trim().toLowerCase() ?? "");
}

export interface TrustBoundaryInput {
  authDisabled?: boolean;
  desktop: boolean;
  desktopSecret: string | undefined;
  credentials: { username: string; password: string };
}

export interface TrustBoundary {
  desktop: boolean;
  authDisabled: boolean;
  loginEnabled: boolean;
  sessionKeyMaterial: string | null;
}

export function trustBoundary({
  desktop,
  desktopSecret,
  credentials,
  authDisabled = false,
}: TrustBoundaryInput): TrustBoundary {
  if (!desktop) {
    return {
      desktop: false,
      authDisabled,
      loginEnabled: !authDisabled,
      sessionKeyMaterial: authDisabled ? null : `pi-work-auth:${credentials.username}:${credentials.password}`,
    };
  }
  const secret = desktopSecret?.trim();
  return {
    desktop: true,
    authDisabled: false,
    loginEnabled: false,
    sessionKeyMaterial: secret ? `pi-work-desktop:${secret}` : null,
  };
}

export interface TerminalHostInput {
  desktop: boolean;
  env: Record<string, string | undefined>;
}

export function resolveTerminalHost({ desktop, env }: TerminalHostInput): string {
  if (desktop) return LOOPBACK_HOST;
  return env.PI_WORK_TERMINAL_HOST?.trim() || LOOPBACK_HOST;
}
