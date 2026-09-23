import { describe, expect, it } from "vitest";
import {
  LOOPBACK_HOST,
  desktopModeRequested,
  resolveTerminalHost,
  trustBoundary,
} from "@/lib/shared/trust-boundary";

describe("desktopModeRequested", () => {
  it("is off when PI_WORK_DESKTOP is unset, empty or blank", () => {
    expect(desktopModeRequested({})).toBe(false);
    expect(desktopModeRequested({ PI_WORK_DESKTOP: "" })).toBe(false);
    expect(desktopModeRequested({ PI_WORK_DESKTOP: "   " })).toBe(false);
  });

  it("is on for 1 / true / yes, in any case", () => {
    expect(desktopModeRequested({ PI_WORK_DESKTOP: "1" })).toBe(true);
    expect(desktopModeRequested({ PI_WORK_DESKTOP: "true" })).toBe(true);
    expect(desktopModeRequested({ PI_WORK_DESKTOP: " YES " })).toBe(true);
  });

  it("is off for the explicit falsy flags", () => {
    for (const value of ["0", "false", "no", "off", "FALSE"]) {
      expect(desktopModeRequested({ PI_WORK_DESKTOP: value })).toBe(false);
    }
  });
});

describe("trustBoundary", () => {
  const credentials = { username: "admin", password: "admin" };

  it("keeps the credential signer and the login page on the server track", () => {
    const boundary = trustBoundary({ desktop: false, desktopSecret: undefined, credentials });

    expect(boundary.desktop).toBe(false);
    expect(boundary.loginEnabled).toBe(true);
    expect(boundary.sessionKeyMaterial).toBe("pi-work-auth:admin:admin");
  });

  it("signs with the shell's secret and closes the login page on the desktop track", () => {
    const boundary = trustBoundary({ desktop: true, desktopSecret: "abc123", credentials });

    expect(boundary.desktop).toBe(true);
    expect(boundary.loginEnabled).toBe(false);
    expect(boundary.sessionKeyMaterial).toBe("pi-work-desktop:abc123");
    expect(boundary.sessionKeyMaterial).not.toContain(credentials.password);
  });

  it("signs nothing in desktop mode without a secret", () => {
    const noSecret = trustBoundary({ desktop: true, desktopSecret: undefined, credentials });
    const blankSecret = trustBoundary({ desktop: true, desktopSecret: "   ", credentials });

    expect(noSecret.sessionKeyMaterial).toBeNull();
    expect(blankSecret.sessionKeyMaterial).toBeNull();
  });

  it("gives every launch its own key material", () => {
    const first = trustBoundary({ desktop: true, desktopSecret: "launch-1", credentials });
    const second = trustBoundary({ desktop: true, desktopSecret: "launch-2", credentials });

    expect(first.sessionKeyMaterial).not.toBe(second.sessionKeyMaterial);
  });
});

describe("resolveTerminalHost", () => {
  it("binds loopback by default", () => {
    expect(resolveTerminalHost({ desktop: false, env: {} })).toBe(LOOPBACK_HOST);
  });

  it("honours PI_WORK_TERMINAL_HOST on the server track", () => {
    expect(resolveTerminalHost({ desktop: false, env: { PI_WORK_TERMINAL_HOST: "0.0.0.0" } })).toBe(
      "0.0.0.0",
    );
  });

  it("ignores the override in desktop mode", () => {
    expect(resolveTerminalHost({ desktop: true, env: { PI_WORK_TERMINAL_HOST: "0.0.0.0" } })).toBe(
      LOOPBACK_HOST,
    );
  });
});
