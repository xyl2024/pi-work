import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_PICKER_ITEMS,
  createComposerPicker,
  type ComposerPickerItem,
} from "@/lib/client/composer-picker";

const MAIN_ITEM_COUNT = COMPOSER_PICKER_ITEMS.length;

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
