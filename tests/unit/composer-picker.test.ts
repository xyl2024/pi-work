import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_PICKER_ITEMS,
  createComposerPicker,
  filterComposerSkills,
  type ComposerPickerItem,
} from "@/lib/client/composer-picker";
import type { DirectoryListingSourceEntry } from "@/lib/client/directory-listing";
import type { SlashResource } from "@/lib/shared/slash-commands";

const MAIN_ITEM_COUNT = COMPOSER_PICKER_ITEMS.length;

const SKILLS: SlashResource[] = [
  { source: "skill", name: "diagnosing-bugs", command: "skill:diagnosing-bugs", description: "Diagnosis loop for hard bugs", path: "/skills/diagnosing-bugs" },
  { source: "skill", name: "tdd", command: "skill:tdd", description: "Test-driven development", path: "/skills/tdd" },
  { source: "action", name: "new", command: "new", description: "Start a new session", path: "" },
];

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
  many: Array.from({ length: 6 }, (_, index) => ({ name: `file-${index}.md`, isDir: false })),
};

const EMPTY_FILE_STATE = {
  directory: "",
  entries: [],
  selected: [],
  activeIndex: 0,
  page: 0,
  loading: false,
  error: null,
};

function createHarness(options: { fail?: Set<string> } = {}) {
  const calls: string[] = [];
  const picker = createComposerPicker({
    fileAdapter: {
      async list(directory) {
        calls.push(directory);
        if (options.fail?.has(directory)) throw new Error(`cannot list ${directory || "/"}`);
        return LISTINGS[directory] ?? [];
      },
    },
  });
  return { picker, calls };
}

describe("composer picker initial state", () => {
  it("starts closed on the main view with the first item active and no file state", () => {
    const picker = createComposerPicker();

    expect(picker.get()).toEqual({
      open: false,
      view: "main",
      activeIndex: 0,
      skillQuery: "",
      file: EMPTY_FILE_STATE,
    });
  });

  it("offers image, skill and file entries in that order", () => {
    const items: readonly ComposerPickerItem[] = COMPOSER_PICKER_ITEMS;

    expect(items.map((item) => item.action)).toEqual(["image", "skill", "file"]);
    expect(items.map((item) => item.opensView)).toEqual([false, true, true]);
  });
});

describe("opening and closing", () => {
  it("opens on the main view and closes back to the initial state", () => {
    const picker = createComposerPicker();

    picker.open();
    expect(picker.get()).toEqual({
      open: true,
      view: "main",
      activeIndex: 0,
      skillQuery: "",
      file: EMPTY_FILE_STATE,
    });

    picker.close();
    expect(picker.get().open).toBe(false);
    expect(picker.get().view).toBe("main");
  });

  it("toggles between open and closed", () => {
    const picker = createComposerPicker();

    picker.toggle();
    expect(picker.get().open).toBe(true);
    picker.toggle();
    expect(picker.get().open).toBe(false);
  });

  it("reopens on the main view after being closed from a secondary view", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.activate(1);
    expect(picker.get().view).toBe("skill");

    picker.close();
    picker.open();
    expect(picker.get().view).toBe("main");
    expect(picker.get().skillQuery).toBe("");
  });

  it("notifies subscribers only when the snapshot changes", () => {
    const picker = createComposerPicker();
    const listener = vi.fn();
    const unsubscribe = picker.subscribe(listener);

    picker.open();
    picker.open();
    picker.close();
    picker.close();
    unsubscribe();
    picker.open();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("main view activation", () => {
  it("resets after the immediate image action", () => {
    const picker = createComposerPicker();

    picker.open();
    const activation = picker.activate(0);

    expect(activation).toEqual({ action: "image", closed: true, view: "main" });
    expect(picker.get().open).toBe(false);
    expect(picker.get().view).toBe("main");
  });

  it("enters the skill view without closing and keeps the picker resettable", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.setActiveIndex(1);
    const activation = picker.activate();

    expect(activation).toEqual({ action: "skill", closed: false, view: "skill" });
    expect(picker.get().view).toBe("skill");
    expect(picker.get().activeIndex).toBe(0);

    picker.reset();
    expect(picker.get().open).toBe(false);
    expect(picker.get().view).toBe("main");
  });

  it("enters the file view without closing", () => {
    const picker = createComposerPicker();

    picker.open();
    const activation = picker.activate(2);

    expect(activation).toEqual({ action: "file", closed: false, view: "file" });
    expect(picker.get().view).toBe("file");
    expect(picker.get().activeIndex).toBe(0);
  });

  it("does nothing outside the main view or while closed", () => {
    const picker = createComposerPicker();

    expect(picker.activate(0)).toBeNull();

    picker.open();
    picker.openView("file");
    expect(picker.activate(0)).toBeNull();
    expect(picker.get().view).toBe("file");
  });
});

describe("navigating between views", () => {
  it("returns from a secondary view to the main view and clears its state", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("file");
    picker.setFileActiveIndex(0);

    expect(picker.back()).toEqual({ closed: false });
    expect(picker.get().view).toBe("main");
    expect(picker.get().file).toEqual(EMPTY_FILE_STATE);
  });

  it("closes from the main view", () => {
    const picker = createComposerPicker();

    picker.open();

    expect(picker.back()).toEqual({ closed: true });
    expect(picker.get().open).toBe(false);
  });

  it("reports no change when backing out while closed", () => {
    const picker = createComposerPicker();

    expect(picker.back()).toEqual({ closed: false });
    expect(picker.get().open).toBe(false);
  });

  it("resets the active index when switching views", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.setActiveIndex(2);
    picker.openView("skill");
    expect(picker.get().activeIndex).toBe(0);

    picker.setActiveIndex(1);
    picker.back();
    expect(picker.get().activeIndex).toBe(0);
  });
});

describe("active item navigation", () => {
  it("wraps arrow navigation around the current item count", () => {
    const picker = createComposerPicker();
    picker.open();

    picker.moveActive(1, MAIN_ITEM_COUNT);
    expect(picker.get().activeIndex).toBe(1);

    picker.moveActive(2, MAIN_ITEM_COUNT);
    expect(picker.get().activeIndex).toBe(0);

    picker.moveActive(-1, MAIN_ITEM_COUNT);
    expect(picker.get().activeIndex).toBe(MAIN_ITEM_COUNT - 1);
  });

  it("ignores navigation when there are no items", () => {
    const picker = createComposerPicker();
    picker.open();

    picker.moveActive(1, 0);
    expect(picker.get().activeIndex).toBe(0);
  });

  it("clamps a direct active index to the available items", () => {
    const picker = createComposerPicker();
    picker.open();

    picker.setActiveIndex(99, 3);
    expect(picker.get().activeIndex).toBe(2);
    picker.setActiveIndex(-5, 3);
    expect(picker.get().activeIndex).toBe(0);
  });
});

describe("skill filtering", () => {
  it("keeps only skills and preserves their order without a query", () => {
    expect(filterComposerSkills(SKILLS, "").map((skill) => skill.name)).toEqual([
      "diagnosing-bugs",
      "tdd",
    ]);
  });

  it("matches skill names case-insensitively", () => {
    expect(filterComposerSkills(SKILLS, "BUG").map((skill) => skill.name)).toEqual([
      "diagnosing-bugs",
    ]);
  });

  it("matches skill descriptions", () => {
    expect(filterComposerSkills(SKILLS, "driven").map((skill) => skill.name)).toEqual(["tdd"]);
  });

  it("returns no skills when nothing matches", () => {
    expect(filterComposerSkills(SKILLS, "missing")).toEqual([]);
  });
});

describe("skill view state", () => {
  it("clears the skill query when leaving the skill view", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("skill");
    picker.setSkillQuery("bug");
    expect(picker.get().skillQuery).toBe("bug");

    picker.back();
    expect(picker.get().skillQuery).toBe("");
  });

  it("clears the skill query when the picker resets", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("skill");
    picker.setSkillQuery("bug");
    picker.reset();

    expect(picker.get().skillQuery).toBe("");
  });

  it("resets the active skill to the first match when the query changes", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("skill");
    picker.setActiveIndex(1, 2);
    picker.setSkillQuery("td");

    expect(picker.get().activeIndex).toBe(0);
  });

  it("navigates the filtered skill list in a wrap-around", () => {
    const picker = createComposerPicker();
    const skills = filterComposerSkills(SKILLS, "");

    picker.open();
    picker.openView("skill");
    picker.moveActive(1, skills.length);
    expect(picker.get().activeIndex).toBe(1);

    picker.moveActive(1, skills.length);
    expect(picker.get().activeIndex).toBe(0);

    picker.moveActive(-1, skills.length);
    expect(picker.get().activeIndex).toBe(1);
  });

  it("hands the active skill to the slash-selection path and resets", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("skill");
    picker.setSkillQuery("driven");

    expect(picker.selectSkill(SKILLS)?.name).toBe("tdd");
    expect(picker.get().open).toBe(false);
    expect(picker.get().view).toBe("main");
    expect(picker.get().skillQuery).toBe("");
  });

  it("keeps the picker open when no skill matches", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("skill");
    picker.setSkillQuery("missing");

    expect(picker.selectSkill(SKILLS)).toBeNull();
    expect(picker.get().open).toBe(true);
    expect(picker.get().view).toBe("skill");
  });

  it("ignores skill selection outside the skill view", () => {
    const picker = createComposerPicker();

    expect(picker.selectSkill(SKILLS)).toBeNull();

    picker.open();
    expect(picker.selectSkill(SKILLS)).toBeNull();
    expect(picker.get().view).toBe("main");
  });
});

describe("file view browsing", () => {
  it("loads the cwd root without a parent row", async () => {
    const { picker, calls } = createHarness();

    await picker.loadFileDirectory();

    expect(calls).toEqual([""]);
    expect(picker.get().file.entries).toEqual([
      { name: "src", path: "src", isDir: true },
      { name: "README.md", path: "README.md", isDir: false },
    ]);
  });

  it("opens a directory with a parent row that navigates upward", async () => {
    const { picker } = createHarness();

    await picker.navigateFileDirectory("src");
    expect(picker.get().file.entries[0]).toEqual({
      name: "..",
      path: "",
      isDir: true,
      isParent: true,
    });

    await picker.activateFile(picker.get().file.entries[0]);

    expect(picker.get().file.directory).toBe("");
    expect(picker.get().file.entries.map((entry) => entry.path)).toEqual(["src", "README.md"]);
  });

  it("distinguishes an empty subdirectory from its parent row", async () => {
    const { picker } = createHarness();

    await picker.navigateFileDirectory("src/nested");

    expect(picker.get().file.entries).toEqual([
      { name: "..", path: "src", isDir: true, isParent: true },
    ]);
    expect(picker.hasFileEntries()).toBe(false);
    expect(picker.get().file.loading).toBe(false);
    expect(picker.get().file.error).toBeNull();
  });

  it("reuses a cached directory listing when navigating back", async () => {
    const { picker, calls } = createHarness();

    await picker.navigateFileDirectory("src");
    await picker.navigateFileDirectory("");
    await picker.navigateFileDirectory("src");

    expect(calls).toEqual(["src", ""]);
  });

  it("rejects unsafe paths and keeps the current directory", async () => {
    const { picker, calls } = createHarness();

    await picker.navigateFileDirectory("src");
    await expect(picker.navigateFileDirectory("../outside")).resolves.toBe(false);
    await expect(picker.navigateFileDirectory("/etc")).resolves.toBe(false);

    expect(picker.get().file.directory).toBe("src");
    expect(calls).toEqual(["src"]);
  });

  it("reports listing failures separately from empty directories", async () => {
    const { picker } = createHarness({ fail: new Set(["docs"]) });

    await picker.navigateFileDirectory("docs");

    expect(picker.get().file.entries).toEqual([]);
    expect(picker.get().file.error).toContain("cannot list docs");
    expect(picker.hasFileEntries()).toBe(false);
  });

  it("retries the current directory after a failure", async () => {
    const fail = new Set(["docs"]);
    const { picker, calls } = createHarness({ fail });

    await picker.navigateFileDirectory("docs");
    fail.delete("docs");
    await picker.retryFileDirectory();

    expect(calls).toEqual(["docs", "docs"]);
    expect(picker.get().file.error).toBeNull();
    expect(picker.get().file.entries.map((entry) => entry.path)).toEqual([
      "",
      "docs/guide.md",
      "docs/api.md",
      "docs/notes.md",
    ]);
  });

  it("keeps browsing state isolated between picker instances", async () => {
    const first = createHarness();
    const second = createHarness();

    await first.picker.navigateFileDirectory("src");
    await second.picker.navigateFileDirectory("docs");

    expect(first.picker.get().file.directory).toBe("src");
    expect(second.picker.get().file.directory).toBe("docs");
    expect(first.calls).toEqual(["src"]);
    expect(second.calls).toEqual(["docs"]);
  });
});

describe("file pagination and active row", () => {
  it("pages through entries with the shared directory page size", async () => {
    const { picker } = createHarness();

    await picker.navigateFileDirectory("docs");

    expect(picker.filePageCount()).toBe(1);
    expect(picker.fileVisibleEntries().map((entry) => entry.name)).toEqual([
      "..",
      "guide.md",
      "api.md",
      "notes.md",
    ]);
  });

  it("pages through a long directory with the shared page size", async () => {
    const { picker } = createHarness();

    await picker.navigateFileDirectory("many");

    expect(picker.filePageCount()).toBe(2);
    expect(picker.fileVisibleEntries().map((entry) => entry.name)).toEqual([
      "..",
      "file-0.md",
      "file-1.md",
      "file-2.md",
      "file-3.md",
    ]);

    picker.nextFilePage(1);

    expect(picker.get().file.page).toBe(1);
    expect(picker.get().file.activeIndex).toBe(0);
    expect(picker.fileVisibleEntries().map((entry) => entry.name)).toEqual([
      "file-4.md",
      "file-5.md",
    ]);

    picker.nextFilePage(1);
    expect(picker.get().file.page).toBe(0);
  });

  it("wraps arrow navigation within the visible page", async () => {
    const { picker } = createHarness();

    await picker.navigateFileDirectory("src");
    expect(picker.get().file.activeIndex).toBe(0);

    picker.moveFileActive(-1);
    expect(picker.get().file.activeIndex).toBe(2);

    picker.moveFileActive(1);
    expect(picker.get().file.activeIndex).toBe(0);
  });

  it("clamps a direct active row to the visible page", async () => {
    const { picker } = createHarness();

    await picker.navigateFileDirectory("src");
    picker.setFileActiveIndex(99);
    expect(picker.get().file.activeIndex).toBe(2);

    picker.setFileActiveIndex(-3);
    expect(picker.get().file.activeIndex).toBe(0);
  });
});

describe("file selection and confirmation", () => {
  it("inserts a single file as a formatted reference and resets the picker", async () => {
    const { picker } = createHarness();

    await picker.loadFileDirectory();
    picker.setFileActiveIndex(1);
    const result = await picker.activateFile();

    expect(result).toEqual({ kind: "insert", text: "`./README.md` " });
    expect(picker.get().open).toBe(false);
    expect(picker.get().file).toEqual(EMPTY_FILE_STATE);
  });

  it("toggles files in and out of the multi-selection but never directories", async () => {
    const { picker } = createHarness();

    await picker.loadFileDirectory();
    expect(picker.toggleFileSelected()).toBe(false);

    picker.setFileActiveIndex(1);
    expect(picker.toggleFileSelected()).toBe(true);
    expect(picker.get().file.selected).toEqual(["README.md"]);

    expect(picker.toggleFileSelected()).toBe(true);
    expect(picker.get().file.selected).toEqual([]);
  });

  it("keeps selections while browsing directories and confirms them together", async () => {
    const { picker } = createHarness();

    await picker.loadFileDirectory();
    picker.setFileActiveIndex(1);
    picker.toggleFileSelected();

    await picker.navigateFileDirectory("src");
    picker.setFileActiveIndex(2);
    picker.toggleFileSelected();

    expect(picker.get().file.selected).toEqual(["README.md", "src/app.ts"]);
    expect(picker.confirmFileSelection()).toBe("`./README.md` `./src/app.ts` ");
    expect(picker.get().open).toBe(false);
    expect(picker.get().file).toEqual(EMPTY_FILE_STATE);
  });

  it("returns null and changes nothing when confirming without a selection", async () => {
    const { picker } = createHarness();

    await picker.loadFileDirectory();

    expect(picker.confirmFileSelection()).toBeNull();
    expect(picker.get().file.directory).toBe("");
    expect(picker.get().file.entries.length).toBe(2);
  });
});

describe("composer picker module boundary", () => {
  it("keeps React subscriptions in the UI wiring layer", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../lib/client/composer-picker.ts", import.meta.url)),
      "utf8",
    );
    const listingSource = readFileSync(
      fileURLToPath(new URL("../../lib/client/directory-listing.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain('from "react"');
    expect(source).not.toContain("useSyncExternalStore");
    expect(listingSource).not.toContain('from "react"');
    expect(listingSource).not.toContain("useSyncExternalStore");
  });
});
