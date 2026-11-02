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
    closeEvents: () => {}, connectEvents: () => {}, ensureEventsConnected: async () => {},
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

async function sendFirstMessage(assistantSession: boolean): Promise<Record<string, unknown>> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn(async (...args: [url: string, init?: RequestInit]) => {
    if (args[0] === "/api/agent/new") return Response.json({ sessionId: "session-1" });
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  let current: UseAgentSessionResult | undefined;
  function Harness() {
    const result = useAgentSession({
      session: null,
      newSessionCwd: "/fixture",
      isActive: false,
      assistantSession,
    });
    useLayoutEffect(() => { current = result; }, [result]);
    return null;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(Harness)));
  await act(async () => { await current?.handleSend("你好"); });
  const call = fetchMock.mock.calls.find(([url]) => url === "/api/agent/new");
  expect(call).toBeDefined();
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

describe("new assistant session request", () => {
  it("marks the first message from the assistant page as an assistant session", async () => {
    const body = await sendFirstMessage(true);
    expect(body.assistant).toBe(true);
  });

  it("keeps ordinary first messages unmarked", async () => {
    const body = await sendFirstMessage(false);
    expect(body.assistant).toBeUndefined();
  });
});
