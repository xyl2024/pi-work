// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentSession } from "@/hooks/useAgentSession/hook";
import type { UseAgentSessionResult } from "@/hooks/useAgentSession/types";

vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/hooks/useI18n", () => ({ useI18n: () => ({ t: (s: string) => s }) }));
vi.mock("@/hooks/useAgentSession/transport", () => ({
  useAgentSessionTransport: () => ({
    closeEvents: () => {},
    connectEvents: () => {},
    ensureEventsConnected: async () => {},
  }),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

function stubFetch(newSession: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/models") return Response.json({ models: {} });
    if (url.startsWith("/api/cwd-tools")) return Response.json({ selection: "all" });
    if (url === "/api/agent/new") return newSession();
    if (url.startsWith("/api/agent/")) return Response.json({ state: {} });
    throw new Error(`Unexpected request: ${url}`);
  }));
}

async function mountHook(newSessionCwd: string | null) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let current: UseAgentSessionResult | undefined;
  function Harness() {
    const result = useAgentSession({ session: null, newSessionCwd, isActive: true });
    useLayoutEffect(() => { current = result; }, [result]);
    return null;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(Harness)));
  return () => current;
}

describe("agent session send result", () => {
  it("reports a successful first send", async () => {
    stubFetch(async () => Response.json({ sessionId: "new-session" }));
    const result = await mountHook("/pi-work-default");

    let sent = false;
    await act(async () => {
      sent = await result()!.handleSend("hello");
    });

    expect(sent).toBe(true);
  });

  it("reports a failed first send so the caller can keep the prompt", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    const result = await mountHook("/pi-work-default");

    let sent = true;
    await act(async () => {
      sent = await result()!.handleSend("hello");
    });

    expect(sent).toBe(false);
  });

  it("reports a refused send when the new session has no cwd", async () => {
    stubFetch(async () => Response.json({ sessionId: "unused" }));
    const result = await mountHook(null);

    let sent = true;
    await act(async () => {
      sent = await result()!.handleSend("hello");
    });

    expect(sent).toBe(false);
  });
});
