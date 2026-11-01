import { describe, expect, it } from "vitest";
import {
  createComposerFilePicker,
  type ComposerFileListEntry,
  type ComposerFilePickerAdapter,
} from "@/lib/client/composer-file-picker";

const LISTINGS: Record<string, ComposerFileListEntry[]> = {
  "": [
    { name: "src", isDir: true },
    { name: "README.md", isDir: false },
  ],
  src: [
    { name: "nested", isDir: true },
    { name: "app.ts", isDir: false },
  ],
  "src/nested": [],
  docs: [
    { name: "guide.md", isDir: false },
    { name: "api.md", isDir: false },
    { name: "notes.md", isDir: false },
  ],
};

function createHarness(options: { pageSize?: number; fail?: Set<string> } = {}) {
  const calls: string[] = [];
  const adapter: ComposerFilePickerAdapter = {
    async list(directory) {
      calls.push(directory);
      if (options.fail?.has(directory)) throw new Error(`cannot list ${directory || "/"}`);
      return LISTINGS[directory] ?? [];
    },
  };
  const picker = createComposerFilePicker({ adapter, pageSize: options.pageSize });
  return { picker, calls };
}

describe("composer file picker initial state", () => {
  it("starts at the cwd root with nothing loaded or selected", () => {
    const { picker } = createHarness();

    expect(picker.get()).toEqual({
      directory: "",
      entries: [],
      selected: [],
      activeIndex: 0,
      page: 0,
      loading: false,
      error: null,
    });
    expect(picker.visibleEntries()).toEqual([]);
    expect(picker.pageCount()).toBe(1);
  });

  it("resets browsing and selection back to the empty root state", async () => {
    const { picker } = createHarness();

    await picker.load();
    await picker.navigate("src");
    picker.toggleSelected();
    picker.nextPage(1);
    picker.reset();

    expect(picker.get()).toEqual({
      directory: "",
      entries: [],
      selected: [],
      activeIndex: 0,
      page: 0,
      loading: false,
      error: null,
    });
  });
});

describe("directory loading", () => {
  it("loads the cwd root without a parent row", async () => {
    const { picker, calls } = createHarness();

    await picker.load();

    expect(calls).toEqual([""]);
    expect(picker.get().loading).toBe(false);
    expect(picker.get().error).toBeNull();
    expect(picker.get().entries).toEqual([
      { name: "src", path: "src", isDir: true },
      { name: "README.md", path: "README.md", isDir: false },
    ]);
  });

  it("opens a directory with a parent row that navigates upward", async () => {
    const { picker } = createHarness();

    await picker.navigate("src");
    expect(picker.get().entries).toEqual([
      { name: "..", path: "", isDir: true, isParent: true },
      { name: "nested", path: "src/nested", isDir: true },
      { name: "app.ts", path: "src/app.ts", isDir: false },
    ]);

    await picker.activate(picker.get().entries[0]);

    expect(picker.get().directory).toBe("");
    expect(picker.get().entries.map((entry) => entry.path)).toEqual(["src", "README.md"]);
  });

  it("reuses a cached directory listing when navigating back", async () => {
    const { picker, calls } = createHarness();

    await picker.navigate("src");
    await picker.navigate("");
    await picker.navigate("src");

    expect(calls).toEqual(["src", ""]);
  });

  it("returns false and keeps the current directory for unsafe paths", async () => {
    const { picker, calls } = createHarness();

    await picker.navigate("src");
    await expect(picker.navigate("../outside")).resolves.toBe(false);
    await expect(picker.navigate("/etc")).resolves.toBe(false);
    await expect(picker.navigate("..")).resolves.toBe(false);

    expect(picker.get().directory).toBe("src");
    expect(calls).toEqual(["src"]);
  });

  it("reports listing failures separately from empty directories", async () => {
    const { picker } = createHarness({ fail: new Set(["docs"]) });

    await picker.navigate("docs");

    expect(picker.get().entries).toEqual([]);
    expect(picker.get().loading).toBe(false);
    expect(picker.get().error).toContain("cannot list docs");

    await picker.navigate("src/nested");

    expect(picker.get().entries).toEqual([
      { name: "..", path: "src", isDir: true, isParent: true },
    ]);
    expect(picker.get().error).toBeNull();
  });

  it("retries the current directory after a failure", async () => {
    const fail = new Set(["docs"]);
    const { picker, calls } = createHarness({ fail });

    await picker.navigate("docs");
    expect(picker.get().error).not.toBeNull();

    fail.delete("docs");
    await picker.retry();

    expect(calls).toEqual(["docs", "docs"]);
    expect(picker.get().error).toBeNull();
    expect(picker.get().entries.map((entry) => entry.path)).toEqual([
      "",
      "docs/guide.md",
      "docs/api.md",
      "docs/notes.md",
    ]);
  });
});

describe("pagination and active row", () => {
  it("pages through entries with the injected page size", async () => {
    const { picker } = createHarness({ pageSize: 2 });

    await picker.navigate("docs");

    expect(picker.pageCount()).toBe(2);
    expect(picker.visibleEntries().map((entry) => entry.name)).toEqual(["..", "guide.md"]);

    picker.nextPage(1);

    expect(picker.get().page).toBe(1);
    expect(picker.get().activeIndex).toBe(0);
    expect(picker.visibleEntries().map((entry) => entry.name)).toEqual(["api.md", "notes.md"]);
  });

  it("wraps page navigation in both directions", async () => {
    const { picker } = createHarness({ pageSize: 2 });

    await picker.navigate("docs");
    picker.nextPage(-1);
    expect(picker.get().page).toBe(1);
    picker.nextPage(1);
    expect(picker.get().page).toBe(0);
  });

  it("wraps arrow navigation within the visible page", async () => {
    const { picker } = createHarness({ pageSize: 2 });

    await picker.navigate("docs");
    expect(picker.get().activeIndex).toBe(0);

    picker.moveActive(-1);
    expect(picker.get().activeIndex).toBe(1);

    picker.moveActive(1);
    expect(picker.get().activeIndex).toBe(0);
  });

  it("clamps a direct active row to the visible page", async () => {
    const { picker } = createHarness({ pageSize: 2 });

    await picker.navigate("docs");
    picker.setActiveIndex(99);
    expect(picker.get().activeIndex).toBe(1);

    picker.setActiveIndex(-3);
    expect(picker.get().activeIndex).toBe(0);
  });
});

describe("file selection and confirmation", () => {
  it("inserts a single file as a formatted reference and resets", async () => {
    const { picker } = createHarness();

    await picker.load();
    picker.setActiveIndex(1);
    const result = await picker.activate();

    expect(result).toEqual({ kind: "insert", text: "`./README.md` " });
    expect(picker.get()).toEqual({
      directory: "",
      entries: [],
      selected: [],
      activeIndex: 0,
      page: 0,
      loading: false,
      error: null,
    });
  });

  it("toggles files in and out of the multi-selection but never directories", async () => {
    const { picker } = createHarness();

    await picker.load();
    expect(picker.toggleSelected()).toBe(false);

    picker.setActiveIndex(1);
    expect(picker.toggleSelected()).toBe(true);
    expect(picker.get().selected).toEqual(["README.md"]);

    expect(picker.toggleSelected()).toBe(true);
    expect(picker.get().selected).toEqual([]);
  });

  it("keeps selections while browsing directories and confirms them together", async () => {
    const { picker } = createHarness();

    await picker.load();
    picker.setActiveIndex(1);
    picker.toggleSelected();

    await picker.navigate("src");
    picker.setActiveIndex(2);
    picker.toggleSelected();

    expect(picker.get().selected).toEqual(["README.md", "src/app.ts"]);
    expect(picker.confirm()).toBe("`./README.md` `./src/app.ts` ");
    expect(picker.get()).toEqual({
      directory: "",
      entries: [],
      selected: [],
      activeIndex: 0,
      page: 0,
      loading: false,
      error: null,
    });
  });

  it("returns null and changes nothing when confirming without a selection", async () => {
    const { picker } = createHarness();

    await picker.load();

    expect(picker.confirm()).toBeNull();
    expect(picker.get().directory).toBe("");
    expect(picker.get().entries.length).toBe(2);
  });
});

describe("in-flight directory loads", () => {
  it("ignores a stale listing that resolves after a newer directory", async () => {
    const pending = new Map<string, (entries: ComposerFileListEntry[]) => void>();
    const picker = createComposerFilePicker({
      adapter: {
        list: (directory) => new Promise((resolve) => pending.set(directory, resolve)),
      },
    });

    const first = picker.navigate("src");
    const second = picker.navigate("docs");
    pending.get("docs")?.(LISTINGS.docs);
    await second;
    pending.get("src")?.(LISTINGS.src);
    await first;

    expect(picker.get().directory).toBe("docs");
    expect(picker.get().entries.map((entry) => entry.path)).toEqual([
      "",
      "docs/guide.md",
      "docs/api.md",
      "docs/notes.md",
    ]);
  });

  it("ignores a listing that resolves after reset and aborts its request", async () => {
    let signal: AbortSignal | undefined;
    let resolveListing: ((entries: ComposerFileListEntry[]) => void) | undefined;
    const picker = createComposerFilePicker({
      adapter: {
        list: (_directory, options) => {
          signal = options.signal;
          return new Promise((resolve) => { resolveListing = resolve; });
        },
      },
    });

    const loading = picker.load();
    picker.reset();
    resolveListing?.(LISTINGS[""]);
    await loading;

    expect(signal?.aborted).toBe(true);
    expect(picker.get()).toEqual({
      directory: "",
      entries: [],
      selected: [],
      activeIndex: 0,
      page: 0,
      loading: false,
      error: null,
    });
  });

  it("notifies subscribers until they unsubscribe", async () => {
    const { picker } = createHarness();
    const seen: string[] = [];
    const unsubscribe = picker.subscribe(() => seen.push(picker.get().directory));

    await picker.navigate("src");
    const notified = seen.length;
    expect(notified).toBeGreaterThan(0);
    expect(seen.every((directory) => directory === "src")).toBe(true);

    unsubscribe();
    await picker.navigate("");

    expect(seen).toHaveLength(notified);
  });
});
