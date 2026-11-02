import { describe, expect, it } from "vitest";
import type { SlashResource } from "@/lib/shared/slash-commands";
import {
  USAGE_COMMAND_ERRORS,
  USAGE_COMMAND_PROMPT,
  USAGE_SKILL_COMMAND,
  createUsageCommandController,
  deliverPendingUsageSend,
  type UsageCommandPort,
  type UsageCommandTab,
} from "@/lib/client/usage-command";

function skillResource(command: string): SlashResource {
  return {
    source: "skill",
    name: command.replace(/^skill:/, ""),
    command,
    description: "",
    path: "",
  };
}

interface HarnessOptions {
  tabs?: UsageCommandTab[];
  resources?: SlashResource[];
  defaultCwdError?: string;
  slashResourcesError?: string;
}

function createHarness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  const toasts: string[] = [];
  const sends: { tabId: string; prompt: string }[] = [];
  const tabs: UsageCommandTab[] = options.tabs ?? [];
  const resources = options.resources ?? [skillResource(USAGE_SKILL_COMMAND)];
  let nextDraftId = 1;
  let activeTabId: string | null = null;

  const port: UsageCommandPort = {
    async requestDefaultCwd() {
      calls.push("default-cwd");
      if (options.defaultCwdError) throw new Error(options.defaultCwdError);
      return "/pi-work-default";
    },
    async querySlashResources(cwd) {
      calls.push(`resources:${cwd}`);
      if (options.slashResourcesError) throw new Error(options.slashResourcesError);
      return resources;
    },
    readSessionTabs() {
      calls.push("tabs");
      return tabs;
    },
    ensureDraft(cwd) {
      const tabId = `draft:new-${nextDraftId++}`;
      calls.push(`ensure-draft:${tabId}:${cwd}`);
      tabs.push({ tabId, kind: "draft", dirty: false });
      return tabId;
    },
    activate(tabId) {
      calls.push(`activate:${tabId}`);
      activeTabId = tabId;
    },
    setDraftCwd(tabId, cwd) {
      calls.push(`set-cwd:${tabId}:${cwd}`);
    },
    scheduleAutoSend(tabId) {
      calls.push(`schedule:${tabId}`);
      sends.push({ tabId, prompt: USAGE_COMMAND_PROMPT });
    },
    showErrorToast(message) {
      toasts.push(message);
    },
  };

  return {
    controller: createUsageCommandController(port),
    calls,
    toasts,
    sends,
    tabs,
    activeTabId: () => activeTabId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("usage command controller", () => {
  it("creates a draft at the default cwd and arranges one fixed auto-send", async () => {
    const harness = createHarness();

    await harness.controller.run();

    const draftId = "draft:new-1";
    expect(harness.tabs).toEqual([{ tabId: draftId, kind: "draft", dirty: false }]);
    expect(harness.calls).toEqual([
      "default-cwd",
      "resources:/pi-work-default",
      "tabs",
      `ensure-draft:${draftId}:/pi-work-default`,
      `activate:${draftId}`,
      `schedule:${draftId}`,
    ]);
    expect(harness.sends).toEqual([{ tabId: draftId, prompt: USAGE_COMMAND_PROMPT }]);
    expect(harness.activeTabId()).toBe(draftId);
    expect(harness.controller.takePendingSend(draftId)).toBe(USAGE_COMMAND_PROMPT);
  });

  it("reuses the first clean draft, moves it to the default cwd and activates it", async () => {
    const harness = createHarness({
      tabs: [
        { tabId: "session:a", kind: "session", dirty: false },
        { tabId: "draft:clean", kind: "draft", dirty: false },
      ],
    });

    await harness.controller.run();

    expect(harness.calls).toContain("set-cwd:draft:clean:/pi-work-default");
    expect(harness.calls).toContain("activate:draft:clean");
    expect(harness.calls.some((call) => call.startsWith("ensure-draft:"))).toBe(false);
    expect(harness.sends).toEqual([{ tabId: "draft:clean", prompt: USAGE_COMMAND_PROMPT }]);
    expect(harness.activeTabId()).toBe("draft:clean");
  });

  it("leaves a dirty draft untouched and creates a new one", async () => {
    const harness = createHarness({
      tabs: [{ tabId: "draft:dirty", kind: "draft", dirty: true }],
    });

    await harness.controller.run();

    expect(harness.calls.some((call) => call.includes("draft:dirty"))).toBe(false);
    expect(harness.tabs[0]).toEqual({ tabId: "draft:dirty", kind: "draft", dirty: true });
    expect(harness.sends).toEqual([{ tabId: "draft:new-1", prompt: USAGE_COMMAND_PROMPT }]);
    expect(harness.activeTabId()).toBe("draft:new-1");
  });

  it("picks the first clean draft in tab order when several are clean", async () => {
    const harness = createHarness({
      tabs: [
        { tabId: "draft:second", kind: "draft", dirty: false },
        { tabId: "draft:third", kind: "draft", dirty: true },
        { tabId: "draft:fourth", kind: "draft", dirty: false },
      ],
    });

    await harness.controller.run();

    expect(harness.sends).toEqual([{ tabId: "draft:second", prompt: USAGE_COMMAND_PROMPT }]);
    expect(harness.calls.some((call) => call.includes("draft:fourth"))).toBe(false);
    expect(harness.calls.some((call) => call.includes("draft:third"))).toBe(false);
  });

  it("shows an error and stops when the default cwd request fails", async () => {
    const harness = createHarness({ defaultCwdError: "boom" });

    await harness.controller.run();

    expect(harness.toasts).toEqual([USAGE_COMMAND_ERRORS.defaultCwd]);
    expect(harness.calls).toEqual(["default-cwd"]);
    expect(harness.tabs).toEqual([]);
    expect(harness.sends).toEqual([]);
    expect(harness.activeTabId()).toBeNull();
  });

  it("shows a skill hint and stops when the usage-check skill is unavailable", async () => {
    const harness = createHarness({
      resources: [skillResource("skill:code-review")],
    });

    await harness.controller.run();

    expect(harness.toasts).toEqual([USAGE_COMMAND_ERRORS.skillUnavailable]);
    expect(harness.tabs).toEqual([]);
    expect(harness.sends).toEqual([]);
    expect(harness.activeTabId()).toBeNull();
  });

  it("shows a resource query error instead of the skill hint when the query fails", async () => {
    const harness = createHarness({ slashResourcesError: "offline" });

    await harness.controller.run();

    expect(harness.toasts).toEqual([USAGE_COMMAND_ERRORS.slashResources]);
    expect(harness.tabs).toEqual([]);
    expect(harness.sends).toEqual([]);
    expect(harness.activeTabId()).toBeNull();
  });

  it("treats a missing resource list the same as a disabled skill", async () => {
    const harness = createHarness({ resources: [] });

    await harness.controller.run();

    expect(harness.toasts).toEqual([USAGE_COMMAND_ERRORS.skillUnavailable]);
    expect(harness.sends).toEqual([]);
  });

  it("ignores a second trigger while the first one is still preparing", async () => {
    const cwd = deferred<string>();
    const calls: string[] = [];
    const sends: string[] = [];
    let draftCount = 0;
    let resourceQueries = 0;
    const tabs: UsageCommandTab[] = [];
    const controller = createUsageCommandController({
      requestDefaultCwd: () => {
        calls.push("default-cwd");
        return cwd.promise;
      },
      querySlashResources: async () => {
        resourceQueries += 1;
        return [skillResource(USAGE_SKILL_COMMAND)];
      },
      readSessionTabs: () => tabs,
      ensureDraft: () => {
        draftCount += 1;
        const tabId = `draft:${draftCount}`;
        tabs.push({ tabId, kind: "draft", dirty: false });
        return tabId;
      },
      activate: () => {},
      setDraftCwd: () => {},
      scheduleAutoSend: (tabId) => {
        sends.push(tabId);
      },
      showErrorToast: () => {},
    });

    const first = controller.run();
    const second = controller.run();
    cwd.resolve("/pi-work-default");
    await Promise.all([first, second]);

    expect(calls).toEqual(["default-cwd"]);
    expect(resourceQueries).toBe(1);
    expect(draftCount).toBe(1);
    expect(sends).toEqual(["draft:1"]);
  });

  it("opens another draft when triggered again after the first preparation completed", async () => {
    const harness = createHarness();

    await harness.controller.run();
    await harness.controller.run();

    expect(harness.sends).toEqual([
      { tabId: "draft:new-1", prompt: USAGE_COMMAND_PROMPT },
      { tabId: "draft:new-2", prompt: USAGE_COMMAND_PROMPT },
    ]);
    expect(harness.activeTabId()).toBe("draft:new-2");
  });

  it("keeps a failed auto-send retryable without arranging a second one", async () => {
    const harness = createHarness();

    await harness.controller.run();
    const prompt = harness.controller.takePendingSend("draft:new-1");
    harness.controller.restorePendingSend("draft:new-1", prompt ?? "");

    expect(harness.controller.takePendingSend("draft:new-1")).toBe(USAGE_COMMAND_PROMPT);
    expect(harness.sends).toHaveLength(1);
    expect(harness.calls.filter((call) => call.startsWith("ensure-draft:"))).toHaveLength(1);
    expect(harness.activeTabId()).toBe("draft:new-1");
  });

  it("delivers the pending auto-send exactly once", async () => {
    const harness = createHarness();

    await harness.controller.run();

    expect(harness.controller.takePendingSend("draft:new-1")).toBe(USAGE_COMMAND_PROMPT);
    expect(harness.controller.takePendingSend("draft:new-1")).toBeNull();
    expect(harness.sends).toHaveLength(1);
  });
});

describe("pending usage send delivery", () => {
  function createDelivery(prompt: Promise<boolean>) {
    let stored: string | null = USAGE_COMMAND_PROMPT;
    const restored: string[] = [];
    const claimed: string[] = [];
    const send = async () => prompt;
    return {
      pending: {
        takePendingSend: () => {
          const value = stored;
          stored = null;
          return value;
        },
        restorePendingSend: (_tabId: string, value: string) => {
          restored.push(value);
          stored = value;
        },
      },
      restored,
      claimed,
      send,
      stored: () => stored,
    };
  }

  it("restores the prompt once when the send fails", async () => {
    const delivery = createDelivery(Promise.resolve(false));

    await deliverPendingUsageSend({
      tabId: "draft:1",
      takePendingSend: delivery.pending.takePendingSend,
      restorePendingSend: delivery.pending.restorePendingSend,
      send: delivery.send,
      onClaimed: () => delivery.claimed.push("draft:1"),
    });

    expect(delivery.claimed).toEqual(["draft:1"]);
    expect(delivery.restored).toEqual([USAGE_COMMAND_PROMPT]);
    expect(delivery.stored()).toBe(USAGE_COMMAND_PROMPT);
  });

  it("claims before sending and leaves nothing pending when the send succeeds", async () => {
    const order: string[] = [];
    const delivery = createDelivery(Promise.resolve(true));

    await deliverPendingUsageSend({
      tabId: "draft:1",
      takePendingSend: delivery.pending.takePendingSend,
      restorePendingSend: delivery.pending.restorePendingSend,
      send: async () => {
        order.push("send");
        return true;
      },
      onClaimed: () => order.push("claim"),
    });

    expect(order).toEqual(["claim", "send"]);
    expect(delivery.restored).toEqual([]);
    expect(delivery.stored()).toBeNull();
  });

  it("does nothing when no prompt is pending", async () => {
    let sent = false;
    let claimed = false;

    await deliverPendingUsageSend({
      tabId: "draft:1",
      takePendingSend: () => null,
      restorePendingSend: () => {},
      send: async () => {
        sent = true;
        return true;
      },
      onClaimed: () => {
        claimed = true;
      },
    });

    expect(sent).toBe(false);
    expect(claimed).toBe(false);
  });
});
