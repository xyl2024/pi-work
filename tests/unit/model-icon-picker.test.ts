import { describe, expect, it } from "vitest";
import {
  iconPickerOptions,
  moveIconPickerIndex,
} from "@/lib/shared/model-icon-picker";

describe("icon picker options", () => {
  it("puts the inherit slot in front of every icon candidate", () => {
    const options = iconPickerOptions(["openai", "anthropic"]);

    expect(options).toEqual([
      { kind: "auto" },
      { kind: "icon", id: "openai" },
      { kind: "icon", id: "anthropic" },
    ]);
  });

  it("keeps candidate order and drops duplicates", () => {
    const options = iconPickerOptions(["deepseek", "openai", "deepseek"]);

    expect(options.map((option) => (option.kind === "icon" ? option.id : "auto"))).toEqual([
      "auto",
      "deepseek",
      "openai",
    ]);
  });

  it("only offers the inherit slot when no icon exists", () => {
    expect(iconPickerOptions([])).toEqual([{ kind: "auto" }]);
  });
});

describe("icon picker keyboard movement", () => {
  const count = 9;
  const columns = 3;

  it("moves one cell horizontally and wraps at the edges", () => {
    expect(moveIconPickerIndex(1, "ArrowRight", count, columns)).toBe(2);
    expect(moveIconPickerIndex(2, "ArrowRight", count, columns)).toBe(3);
    expect(moveIconPickerIndex(0, "ArrowLeft", count, columns)).toBe(8);
  });

  it("moves one row vertically and wraps at the edges", () => {
    expect(moveIconPickerIndex(1, "ArrowDown", count, columns)).toBe(4);
    expect(moveIconPickerIndex(4, "ArrowUp", count, columns)).toBe(1);
    expect(moveIconPickerIndex(7, "ArrowDown", count, columns)).toBe(1);
  });

  it("jumps to the first and last candidate", () => {
    expect(moveIconPickerIndex(4, "Home", count, columns)).toBe(0);
    expect(moveIconPickerIndex(4, "End", count, columns)).toBe(8);
  });

  it("stays on the single candidate when the grid is a single column", () => {
    expect(moveIconPickerIndex(0, "ArrowDown", 1, 1)).toBe(0);
    expect(moveIconPickerIndex(0, "ArrowUp", 1, 1)).toBe(0);
  });
});
