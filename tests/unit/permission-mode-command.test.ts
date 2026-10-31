import { describe, expect, it } from "vitest";
import { buildCommands, type CommandContext } from "@/lib/client/commands";
import type { PermissionMode, SessionPermissionMode } from "@/lib/shared/permission-mode";

function makeContext(over: {
  permissionMode?: SessionPermissionMode;
  canChangePermissionMode?: boolean;
  setPermissionMode?: (mode: PermissionMode) => void;
} = {}) {
  const calls: PermissionMode[] = [];
  const ctx = {
    setTheme: () => {},
    setLocale: () => {},
    newSession: () => {},
    openSettings: () => {},
    openCwdPicker: () => {},
    toggleSidebar: () => {},
    toggleRightPanel: () => {},
    togglePanel: () => {},
    agentControls: {
      abortStreaming: () => {},
      isStreaming: false,
      permissionMode: over.permissionMode ?? "confirm",
      canChangePermissionMode: over.canChangePermissionMode ?? true,
      ...("setPermissionMode" in over
        ? { setPermissionMode: over.setPermissionMode }
        : { setPermissionMode: (mode: PermissionMode) => calls.push(mode) }),
    },
    hasSession: true,
  } as unknown as CommandContext;
  return { ctx, calls };
}

const permissionCommand = (ctx: CommandContext) =>
  buildCommands(ctx, (key) => key).find((cmd) => cmd.id === "session.permission_mode");

describe("the permission-mode palette entry", () => {
  it("offers the way in while the session is confirming", () => {
    const { ctx } = makeContext({ permissionMode: "confirm" });

    expect(permissionCommand(ctx)?.title).toBe("Switch to allow full access");
    expect(permissionCommand(ctx)?.group).toBe("Session");
  });

  it("offers the way back while the session is in full access", () => {
    const { ctx } = makeContext({ permissionMode: "full_access" });

    expect(permissionCommand(ctx)?.title).toBe("Switch to confirm dangerous commands");
  });

  it("is absent for a background auto-deny session", () => {
    const { ctx } = makeContext({ permissionMode: "auto_deny", canChangePermissionMode: false });

    expect(permissionCommand(ctx)).toBeUndefined();
  });

  it("is absent for a background full-access session", () => {
    const { ctx } = makeContext({ permissionMode: "full_access", canChangePermissionMode: false });

    expect(permissionCommand(ctx)).toBeUndefined();
  });

  it("is absent when the active ChatWindow registered no handler", () => {
    const ctx = { ...makeContext().ctx, agentControls: { abortStreaming: () => {}, isStreaming: false } } as unknown as CommandContext;

    expect(permissionCommand(ctx)).toBeUndefined();
  });

  it("flips the mode through the handler, calling run() the way the palette does", () => {
    const { ctx, calls } = makeContext({ permissionMode: "confirm" });

    void permissionCommand(ctx)?.run(undefined as never);
    expect(calls).toEqual(["full_access"]);
  });

  it("flips back from full access", () => {
    const { ctx, calls } = makeContext({ permissionMode: "full_access" });

    void permissionCommand(ctx)?.run(undefined as never);
    expect(calls).toEqual(["confirm"]);
  });
});
