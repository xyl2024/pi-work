import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_PICKER_ITEMS,
  createComposerPicker,
  filterComposerSkills,
  type ComposerPickerItem,
} from "@/lib/client/composer-picker";
import type { SlashResource } from "@/lib/shared/slash-commands";

const MAIN_ITEM_COUNT = COMPOSER_PICKER_ITEMS.length;

const SKILLS: SlashResource[] = [
  { source: "skill", name: "diagnosing-bugs", command: "skill:diagnosing-bugs", description: "Diagnosis loop for hard bugs", path: "/skills/diagnosing-bugs" },
  { source: "skill", name: "tdd", command: "skill:tdd", description: "Test-driven development", path: "/skills/tdd" },
  { source: "action", name: "new", command: "new", description: "Start a new session", path: "" },
];

describe("composer picker initial state", () => {
  it("starts closed on the main view with the first item active", () => {
    const picker = createComposerPicker();

    expect(picker.get()).toEqual({ open: false, view: "main", activeIndex: 0 });
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
    expect(picker.get()).toEqual({ open: true, view: "main", activeIndex: 0 });

    picker.close();
    expect(picker.get()).toEqual({ open: false, view: "main", activeIndex: 0 });
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
    expect(picker.get()).toEqual({ open: true, view: "main", activeIndex: 0 });
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
    expect(picker.get()).toEqual({ open: false, view: "main", activeIndex: 0 });
  });

  it("enters the skill view without closing and keeps the picker resettable", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.setActiveIndex(1);
    const activation = picker.activate();

    expect(activation).toEqual({ action: "skill", closed: false, view: "skill" });
    expect(picker.get()).toEqual({ open: true, view: "skill", activeIndex: 0 });

    picker.reset();
    expect(picker.get()).toEqual({ open: false, view: "main", activeIndex: 0 });
  });

  it("enters the file view without closing", () => {
    const picker = createComposerPicker();

    picker.open();
    const activation = picker.activate(2);

    expect(activation).toEqual({ action: "file", closed: false, view: "file" });
    expect(picker.get()).toEqual({ open: true, view: "file", activeIndex: 0 });
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
  it("returns from a secondary view to the main view", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("file");

    expect(picker.back()).toEqual({ closed: false });
    expect(picker.get()).toEqual({ open: true, view: "main", activeIndex: 0 });
  });

  it("closes from the main view", () => {
    const picker = createComposerPicker();

    picker.open();

    expect(picker.back()).toEqual({ closed: true });
    expect(picker.get()).toEqual({ open: false, view: "main", activeIndex: 0 });
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
    expect(picker.skillQuery()).toBe("bug");

    picker.back();
    expect(picker.skillQuery()).toBe("");
  });

  it("clears the skill query when the picker resets", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("skill");
    picker.setSkillQuery("bug");
    picker.reset();

    expect(picker.skillQuery()).toBe("");
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
    expect(picker.get()).toEqual({ open: false, view: "main", activeIndex: 0 });
    expect(picker.skillQuery()).toBe("");
  });

  it("keeps the picker open when no skill matches", () => {
    const picker = createComposerPicker();

    picker.open();
    picker.openView("skill");
    picker.setSkillQuery("missing");

    expect(picker.selectSkill(SKILLS)).toBeNull();
    expect(picker.get()).toEqual({ open: true, view: "skill", activeIndex: 0 });
  });

  it("ignores skill selection outside the skill view", () => {
    const picker = createComposerPicker();

    expect(picker.selectSkill(SKILLS)).toBeNull();

    picker.open();
    expect(picker.selectSkill(SKILLS)).toBeNull();
    expect(picker.get().view).toBe("main");
  });
});
