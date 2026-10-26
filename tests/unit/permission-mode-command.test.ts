import { describe, expect, it } from "vitest";
import { buildCommands, type CommandContext } from "@/lib/client/commands";
import type { PermissionMode } from "@/lib/shared/permission-mode";

/**
 * The command-palette entry for the permission mode (ADR-0021, ticket 05).
 *
 * The seam is `buildCommands()` — the same function AppShell feeds the palette,
 * so "the entry is there, its title flips, and clicking it goes through the one
 * handler" is asserted without rendering anything. That matters because the
 * palette invokes `run()` with **no argument** (every handler closes over its
 * context): a handler that reads the context off its parameter appears in the
 * list and then throws on click.
 */

function makeContext(over: {
  permissionMode?: PermissionMode;
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

  it("is absent when the active ChatWindow registered no handler", () => {
    // Defense for the `when()` gate itself: a controller that cannot switch
    // the mode must not offer an entry that does nothing. (A draft registers
    // the handler — it picks the mode the session is created with.)
    const ctx = { ...makeContext().ctx, agentControls: { abortStreaming: () => {}, isStreaming: false } } as unknown as CommandContext;

    expect(permissionCommand(ctx)).toBeUndefined();
  });

  it("flips the mode through the handler, calling run() the way the palette does", () => {
    const { ctx, calls } = makeContext({ permissionMode: "confirm" });

    // No argument — exactly how components/app-shell/CommandPalette.tsx calls it.
    void permissionCommand(ctx)?.run(undefined as never);
    expect(calls).toEqual(["full_access"]);
  });

  it("flips back from full access", () => {
    const { ctx, calls } = makeContext({ permissionMode: "full_access" });

    void permissionCommand(ctx)?.run(undefined as never);
    expect(calls).toEqual(["confirm"]);
  });
});
