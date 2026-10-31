import { describe, expect, it } from "vitest";
import {
  canSwitchSessionPermissionMode,
  sessionPermissionBadge,
} from "@/lib/shared/permission-mode";

describe("session permission display", () => {
  it("badges background auto-deny and background full access permanently", () => {
    expect(sessionPermissionBadge("auto_deny", true)).toBe("auto_deny");
    expect(sessionPermissionBadge("full_access", true)).toBe("full_access");
  });

  it("leaves foreground confirm and full access badges exactly as before", () => {
    expect(sessionPermissionBadge("confirm", false)).toBeNull();
    expect(sessionPermissionBadge("full_access", false)).toBeNull();
  });

  it("never treats a background session as switchable", () => {
    expect(canSwitchSessionPermissionMode("confirm", true)).toBe(false);
    expect(canSwitchSessionPermissionMode("full_access", true)).toBe(false);
    expect(canSwitchSessionPermissionMode("auto_deny", true)).toBe(false);
  });

  it("keeps both foreground modes switchable", () => {
    expect(canSwitchSessionPermissionMode("confirm", false)).toBe(true);
    expect(canSwitchSessionPermissionMode("full_access", false)).toBe(true);
  });

  it("never treats auto-deny as a human-switchable mode", () => {
    expect(canSwitchSessionPermissionMode("auto_deny", false)).toBe(false);
  });
});
