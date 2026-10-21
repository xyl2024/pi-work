// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentSession } from "@/hooks/useAgentSession/hook";
import type { SessionData, UseAgentSessionResult } from "@/hooks/useAgentSession/types";
import type { SessionInfo } from "@/lib/shared/types";

vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/hooks/useI18n", () => ({ useI18n: () => ({ t: (s: string) => s }) }));
vi.mock("@/hooks/useAgentSession/transport", () => ({
  useAgentSessionTransport: () => ({
    closeEvents: () => {}, connectEvents: () => {}, ensureEventsConnected: async () => {},
  }),
}));

const model = { provider: "fixture", modelId: "reasoner" };
const session: SessionInfo = {
  id: "thinking-fixture", path: "/fixture/session.jsonl", cwd: "/fixture",
  created: "2026-01-01", modified: "2026-01-01", messageCount: 0,
  firstMessage: "", running: false,
};
const diskData: SessionData = {
  sessionId: session.id, filePath: session.path, tree: [], leafId: null,
  context: { messages: [], entryIds: [], thinkingLevel: "low", model },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

describe("chat thinking level hydration", () => {
  it.each([
    { order: "session-first", supported: ["off", "medium", "high"], expected: "medium" },
    { order: "catalog-first", supported: ["off", "medium", "high"], expected: "medium" },
    { order: "session-first", supported: ["off"], expected: "off" },
    { order: "catalog-first", supported: ["off"], expected: "off" },
    { order: "session-first", supported: ["off", "low", "high"], expected: "low" },
    { order: "catalog-first", supported: ["off", "low", "high"], expected: "low" },
    { order: "session-first", supported: [], expected: "low" },
    { order: "catalog-first", supported: [], expected: "low" },
    { order: "session-first", supported: undefined, expected: "low" },
    { order: "catalog-first", supported: undefined, expected: "low" },
  ])("reconciles low with $supported ($order)", async ({ order, supported, expected }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const catalog = deferred<Response>();
    const disk = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/models") return catalog.promise;
      if (url.startsWith("/api/sessions/")) return disk.promise;
      throw new Error(`Unexpected request: ${url}`);
    }));
    let current: UseAgentSessionResult | undefined;
    function Harness() {
      const result = useAgentSession({ session, newSessionCwd: null, isActive: false });
      useLayoutEffect(() => { current = result; }, [result]);
      return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(Harness)));
    const loadDisk = () => disk.resolve(Response.json(diskData));
    const loadCatalog = () => catalog.resolve(Response.json({
      models: {}, thinkingLevels: supported === undefined ? {} : { "fixture:reasoner": supported },
    }));
    if (order === "session-first") {
      await act(async () => { loadDisk(); });
      expect(current?.thinkingLevel).toBe("low");
      await act(async () => { loadCatalog(); });
    } else {
      await act(async () => { loadCatalog(); });
      await act(async () => { loadDisk(); });
    }
    expect(current?.currentModel).toEqual(model);
    expect(current?.modelThinkingLevels["fixture:reasoner"]).toEqual(supported);
    expect(current?.thinkingLevel).toBe(expected);
    if (supported && supported.length > 0) expect(supported).toContain(current?.thinkingLevel);
  });
});
