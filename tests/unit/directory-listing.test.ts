import { describe, expect, it } from "vitest";
import {
  DIRECTORY_PAGE_SIZE,
  createDirectoryListing,
  pageWindow,
  type DirectoryListingSourceEntry,
} from "@/lib/client/directory-listing";

const LISTINGS: Record<string, DirectoryListingSourceEntry[]> = {
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

function createHarness(options: { fail?: Set<string> } = {}) {
  const calls: string[] = [];
  const listing = createDirectoryListing({
    adapter: {
      async list(directory) {
        calls.push(directory);
        if (options.fail?.has(directory)) throw new Error(`cannot list ${directory || "/"}`);
        return LISTINGS[directory] ?? [];
      },
    },
  });
  return { listing, calls };
}

describe("directory listing", () => {
  it("starts empty at the cwd root", () => {
    const { listing } = createHarness();

    expect(listing.get()).toEqual({
      directory: "",
      entries: [],
      loading: false,
      error: null,
    });
  });

  it("loads the cwd root without a parent row", async () => {
    const { listing, calls } = createHarness();

    await listing.load();

    expect(calls).toEqual([""]);
    expect(listing.get().entries).toEqual([
      { name: "src", path: "src", isDir: true },
      { name: "README.md", path: "README.md", isDir: false },
    ]);
  });

  it("opens a directory with a parent row that points at its parent", async () => {
    const { listing } = createHarness();

    await listing.navigate("src");

    expect(listing.get().entries).toEqual([
      { name: "..", path: "", isDir: true, isParent: true },
      { name: "nested", path: "src/nested", isDir: true },
      { name: "app.ts", path: "src/app.ts", isDir: false },
    ]);
  });

  it("separates parent rows from actual content", async () => {
    const { listing } = createHarness();

    await listing.navigate("src/nested");

    expect(listing.get().entries).toEqual([
      { name: "..", path: "src", isDir: true, isParent: true },
    ]);
    expect(listing.contentEntries()).toEqual([]);
    expect(listing.hasContent()).toBe(false);
  });

  it("reuses a cached directory listing when navigating back", async () => {
    const { listing, calls } = createHarness();

    await listing.navigate("src");
    await listing.navigate("");
    await listing.navigate("src");

    expect(calls).toEqual(["src", ""]);
  });

  it("rejects paths that can escape the cwd", async () => {
    const { listing, calls } = createHarness();

    await listing.navigate("src");

    await expect(listing.navigate("../outside")).resolves.toBe(false);
    await expect(listing.navigate("/etc")).resolves.toBe(false);
    await expect(listing.navigate("..")).resolves.toBe(false);

    expect(listing.get().directory).toBe("src");
    expect(calls).toEqual(["src"]);
  });

  it("reports listing failures separately from empty directories", async () => {
    const { listing } = createHarness({ fail: new Set(["docs"]) });

    await listing.navigate("docs");

    expect(listing.get().entries).toEqual([]);
    expect(listing.get().loading).toBe(false);
    expect(listing.get().error).toContain("cannot list docs");

    await listing.navigate("src/nested");

    expect(listing.get().error).toBeNull();
    expect(listing.hasContent()).toBe(false);
  });

  it("retries the current directory after a failure", async () => {
    const fail = new Set(["docs"]);
    const { listing, calls } = createHarness({ fail });

    await listing.navigate("docs");
    expect(listing.get().error).not.toBeNull();

    fail.delete("docs");
    await listing.retry();

    expect(calls).toEqual(["docs", "docs"]);
    expect(listing.get().error).toBeNull();
    expect(listing.get().entries.map((entry) => entry.path)).toEqual([
      "",
      "docs/guide.md",
      "docs/api.md",
      "docs/notes.md",
    ]);
  });

  it("ignores a stale listing that resolves after a newer directory", async () => {
    const pending = new Map<string, (entries: DirectoryListingSourceEntry[]) => void>();
    const listing = createDirectoryListing({
      adapter: {
        list: (directory) => new Promise((resolve) => pending.set(directory, resolve)),
      },
    });

    const first = listing.navigate("src");
    const second = listing.navigate("docs");
    pending.get("docs")?.(LISTINGS.docs);
    await second;
    pending.get("src")?.(LISTINGS.src);
    await first;

    expect(listing.get().directory).toBe("docs");
    expect(listing.contentEntries().map((entry) => entry.path)).toEqual([
      "docs/guide.md",
      "docs/api.md",
      "docs/notes.md",
    ]);
  });

  it("aborts an in-flight request and ignores it after reset", async () => {
    let signal: AbortSignal | undefined;
    let resolveListing: ((entries: DirectoryListingSourceEntry[]) => void) | undefined;
    const listener = () => undefined;
    const listing = createDirectoryListing({
      adapter: {
        list: (_directory, options) => {
          signal = options.signal;
          return new Promise((resolve) => { resolveListing = resolve; });
        },
      },
    });
    const unsubscribe = listing.subscribe(listener);

    const loading = listing.load();
    listing.reset();
    resolveListing?.(LISTINGS[""]);
    await loading;
    unsubscribe();

    expect(signal?.aborted).toBe(true);
    expect(listing.get()).toEqual({
      directory: "",
      entries: [],
      loading: false,
      error: null,
    });
  });
});

describe("shared page window", () => {
  it("defaults to the shared directory page size", () => {
    expect(DIRECTORY_PAGE_SIZE).toBe(5);
  });

  it("clamps the requested page and slices by the page size", () => {
    expect(pageWindow(["a", "b", "c", "d", "e", "f"], 1, 2)).toEqual({
      pageCount: 3,
      currentPage: 1,
      items: ["c", "d"],
    });

    expect(pageWindow(["a", "b", "c"], 99, 2)).toEqual({
      pageCount: 2,
      currentPage: 1,
      items: ["c"],
    });

    expect(pageWindow([], 0, 5)).toEqual({
      pageCount: 1,
      currentPage: 0,
      items: [],
    });
  });
});
