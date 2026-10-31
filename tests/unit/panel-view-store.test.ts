import { describe, expect, it } from "vitest";
import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewCloseGuard,
  type PanelViewLoadPolicy,
  type PanelViewStore,
} from "@/lib/client/panel-view-store";

interface FakeView {
  data: string | null;
  draft: string;
}

type FakePage = { kind: "root" } | { kind: "detail"; id: string };

interface FakeContext {
  cwd: string;
}

interface PendingLoad {
  key: string;
  signal: AbortSignal;
  resolve(data: string): void;
}

interface HarnessOptions {
  policy?: PanelViewLoadPolicy;
  guard?(view: FakeView): PanelViewCloseGuard | null;
  onRelease?(store: FakeStore): void;
}

type FakeStore = PanelViewStore<FakeView, FakePage, FakeContext>;

function createHarness(options: HarnessOptions = {}) {
  const loads: PendingLoad[] = [];
  const log: string[] = [];
  const ref: { current: FakeStore | null } = { current: null };

  const adapter: PanelViewAdapter<FakeView, FakePage, FakeContext, string> = {
    kind: "fake",
    initial: { data: null, draft: "" },
    rootPage: { kind: "root" },
    loadPolicy: options.policy ?? "once",
    key: (context) => context.cwd,
    load: (key, context) =>
      new Promise<void>((resolve) => {
        loads.push({
          key,
          signal: context.signal,
          resolve: (data) => {
            context.patch({ data });
            resolve();
          },
        });
      }),
    release: () => {
      log.push("release");
      if (options.onRelease && ref.current) options.onRelease(ref.current);
    },
    guard: (view) => (options.guard ? options.guard(view) : null),
    status: (view) => view.data,
    isRootPage: (pages) => pages.length <= 1,
    isSiblingPage: (next, current) =>
      next.kind === "detail" && current.kind === "detail",
  };

  const store = createPanelViewStore(adapter);
  ref.current = store;
  return { store, loads, log };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function detail(id: string): FakePage {
  return { kind: "detail", id };
}

describe("page stack", () => {
  it("starts on the root page and never empties", () => {
    const { store } = createHarness();
    expect(store.pages()).toEqual([{ kind: "root" }]);
    expect(store.pageDepth()).toBe(1);
  });

  it("pushes a non-sibling page above the root", () => {
    const { store } = createHarness();
    store.openPage(detail("a"));
    expect(store.pages()).toEqual([{ kind: "root" }, detail("a")]);
    expect(store.currentPage()).toEqual(detail("a"));
    expect(store.pageDepth()).toBe(2);
  });

  it("replaces a sibling page instead of growing the stack", () => {
    const { store } = createHarness();
    store.openPage(detail("a"));
    store.openPage(detail("b"));
    expect(store.pages()).toEqual([{ kind: "root" }, detail("b")]);
    expect(store.pageDepth()).toBe(2);
  });

  it("resets to the root page on demand", () => {
    const { store } = createHarness();
    store.openPage(detail("a"));
    store.resetPages();
    expect(store.pages()).toEqual([{ kind: "root" }]);
  });

  it("pops only on a non-root page and reports close on the root page", () => {
    const { store } = createHarness();
    store.openPage(detail("a"));
    expect(store.back()).toEqual({ closePanel: false });
    expect(store.pages()).toEqual([{ kind: "root" }]);
    expect(store.back()).toEqual({ closePanel: true });
    expect(store.pages()).toEqual([{ kind: "root" }]);
  });
});

describe("keep-alive", () => {
  it("keeps state and pages across hiding and re-opening for a once policy", async () => {
    const { store, loads } = createHarness();
    store.open({ cwd: "a" });
    store.openPage(detail("a"));
    loads[0].resolve("disk");
    await flush();

    store.setVisible(false);
    store.open({ cwd: "a" });

    expect(store.get().data).toBe("disk");
    expect(store.pageDepth()).toBe(2);
    expect(loads).toHaveLength(1);
  });

  it("only discards state on release", async () => {
    const { store, loads } = createHarness();
    store.open({ cwd: "a" });
    loads[0].resolve("disk");
    await flush();

    store.release();

    expect(store.get()).toEqual({ data: null, draft: "" });
    expect(store.pages()).toEqual([{ kind: "root" }]);
  });
});

describe("release", () => {
  it("cancels the in-flight load and drops late results", async () => {
    const { store, loads } = createHarness();
    store.open({ cwd: "a" });
    expect(loads[0].signal.aborted).toBe(false);

    store.release();
    expect(loads[0].signal.aborted).toBe(true);
    loads[0].resolve("late");
    await flush();

    expect(store.get().data).toBeNull();
  });

  it("is idempotent", () => {
    const { store, log } = createHarness();
    store.open({ cwd: "a" });
    store.release();
    store.release();
    store.release();
    expect(log.filter((entry) => entry === "release")).toHaveLength(1);
  });

  it("reopens with fresh state, never the stale one", async () => {
    const { store, loads } = createHarness({
      onRelease: (reopening) => reopening.open({ cwd: "b" }),
    });
    store.open({ cwd: "a" });
    loads[0].resolve("disk-a");
    await flush();
    expect(store.get().data).toBe("disk-a");

    store.release();

    expect(store.get().data).toBeNull();
    expect(loads).toHaveLength(2);
    expect(loads[1].key).toBe("b");
    expect(store.isReleased()).toBe(false);

    loads[0].resolve("late-a");
    await flush();
    expect(store.get().data).toBeNull();
  });
});

describe("loading", () => {
  it("keeps only the newest result for the same key", async () => {
    const { store, loads } = createHarness();
    store.open({ cwd: "a" });
    store.reload();
    expect(loads).toHaveLength(2);

    loads[0].resolve("stale");
    loads[1].resolve("fresh");
    await flush();

    expect(store.get().data).toBe("fresh");
  });

  it("reuses a loaded once-policy key", async () => {
    const { store, loads } = createHarness();
    store.open({ cwd: "a" });
    loads[0].resolve("disk");
    await flush();

    store.open({ cwd: "a" });
    expect(loads).toHaveLength(1);
  });

  it("reloads on every open for an on-open policy", async () => {
    const { store, loads } = createHarness({ policy: "on-open" });
    store.open({ cwd: "a" });
    store.open({ cwd: "a" });
    expect(loads).toHaveLength(2);
  });

  it("loads only while visible for an on-visible policy", () => {
    const { store, loads } = createHarness({ policy: "on-visible" });
    store.setVisible(false);
    store.open({ cwd: "a" });
    expect(loads).toHaveLength(0);

    store.setVisible(true);
    expect(loads).toHaveLength(1);
  });

  it("loads once when the key changes and ignores the previous key's result", async () => {
    const { store, loads } = createHarness();
    store.open({ cwd: "a" });
    store.open({ cwd: "b" });
    expect(loads.map((load) => load.key)).toEqual(["a", "b"]);

    loads[1].resolve("disk-b");
    await flush();
    loads[0].resolve("late-a");
    await flush();

    expect(store.get().data).toBe("disk-b");
  });
});

describe("close", () => {
  it("closes without asking when the guard is null", async () => {
    const asked: PanelViewCloseGuard[] = [];
    const { store, log } = createHarness();
    const closed = await store.requestClose((guard) => {
      asked.push(guard);
      return true;
    });
    expect(closed).toBe(true);
    expect(asked).toHaveLength(0);
    expect(log).toEqual(["release"]);
  });

  it("keeps the state when the confirmation is cancelled", async () => {
    const { store, loads, log } = createHarness({
      guard: () => ({
        titleKey: "title",
        descriptionKey: "description",
        confirmLabelKey: "confirm",
        discard: () => log.push("discard"),
      }),
    });
    store.open({ cwd: "a" });
    loads[0].resolve("disk");
    await flush();

    const closed = await store.requestClose(() => false);

    expect(closed).toBe(false);
    expect(store.get().data).toBe("disk");
    expect(log).toEqual([]);
  });

  it("asks once, then discards, then releases", async () => {
    const { store, log } = createHarness({
      guard: () => ({
        titleKey: "title",
        descriptionKey: "description",
        confirmLabelKey: "confirm",
        discard: () => log.push("discard"),
      }),
    });

    const closed = await store.requestClose(() => {
      log.push("ask");
      return true;
    });

    expect(closed).toBe(true);
    expect(log).toEqual(["ask", "discard", "release"]);
    expect(store.isReleased()).toBe(true);
  });
});

describe("status", () => {
  it("derives the status from the state", async () => {
    const { store, loads } = createHarness();
    expect(store.status()).toBeNull();
    store.open({ cwd: "a" });
    loads[0].resolve("disk");
    await flush();
    expect(store.status()).toBe("disk");
  });
});
