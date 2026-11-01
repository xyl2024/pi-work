import { describe, expect, it } from "vitest";
import { resolvePickerKeyAction } from "@/lib/client/picker-keyboard";

describe("picker keyboard intent", () => {
  it("activates the active row when Enter is pressed on the trigger or a navigation row", () => {
    expect(resolvePickerKeyAction({ key: "Enter", region: "trigger", view: "main" })).toBe("activate");
    expect(resolvePickerKeyAction({ key: "Enter", region: "navigation", view: "main" })).toBe("activate");
    expect(resolvePickerKeyAction({ key: "Enter", region: "trigger", view: "file" })).toBe("activate");
    expect(resolvePickerKeyAction({ key: "Enter", region: "navigation", view: "file" })).toBe("activate");
  });

  it("leaves footer controls on their native keyboard behavior", () => {
    expect(resolvePickerKeyAction({ key: "Enter", region: "control", view: "file" })).toBe("native");
    expect(resolvePickerKeyAction({ key: " ", region: "control", view: "file" })).toBe("native");
    expect(resolvePickerKeyAction({ key: "ArrowDown", region: "control", view: "file" })).toBe("native");
    expect(resolvePickerKeyAction({ key: "ArrowLeft", region: "control", view: "file" })).toBe("native");
  });

  it("moves the active row from the trigger or a navigation row", () => {
    expect(resolvePickerKeyAction({ key: "ArrowDown", region: "trigger", view: "main" })).toBe("move-next");
    expect(resolvePickerKeyAction({ key: "ArrowUp", region: "trigger", view: "main" })).toBe("move-previous");
    expect(resolvePickerKeyAction({ key: "ArrowDown", region: "navigation", view: "skill" })).toBe("move-next");
    expect(resolvePickerKeyAction({ key: "ArrowUp", region: "navigation", view: "file" })).toBe("move-previous");
  });

  it("pages only in the file view", () => {
    expect(resolvePickerKeyAction({ key: "ArrowRight", region: "navigation", view: "file" })).toBe("page-next");
    expect(resolvePickerKeyAction({ key: "ArrowLeft", region: "navigation", view: "file" })).toBe("page-previous");
    expect(resolvePickerKeyAction({ key: "ArrowRight", region: "navigation", view: "main" })).toBe("native");
    expect(resolvePickerKeyAction({ key: "ArrowLeft", region: "navigation", view: "skill" })).toBe("native");
  });

  it("toggles file selection with Space only on file navigation rows", () => {
    expect(resolvePickerKeyAction({ key: " ", region: "navigation", view: "file" })).toBe("toggle-selection");
    expect(resolvePickerKeyAction({ key: " ", region: "trigger", view: "file" })).toBe("native");
    expect(resolvePickerKeyAction({ key: " ", region: "navigation", view: "main" })).toBe("native");
  });

  it("maps Escape to back regardless of focus region", () => {
    expect(resolvePickerKeyAction({ key: "Escape", region: "trigger", view: "main" })).toBe("back");
    expect(resolvePickerKeyAction({ key: "Escape", region: "navigation", view: "file" })).toBe("back");
    expect(resolvePickerKeyAction({ key: "Escape", region: "control", view: "skill" })).toBe("back");
  });

  it("does not steal keys while composing or outside picker keys", () => {
    expect(resolvePickerKeyAction({ key: "Enter", region: "trigger", view: "main", composing: true })).toBe("native");
    expect(resolvePickerKeyAction({ key: "a", region: "navigation", view: "skill" })).toBe("native");
  });
});
