import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/panels/MainViewMasterDetail.tsx", "utf8");
const focusCall = source.indexOf("el.focus({ preventScroll");
const start = source.lastIndexOf("  useEffect(() => {", focusCall);
const end = source.indexOf("\n  }, [focusKey, visible, ref]);", start);
const runEffect = new Function(
  "ref",
  "document",
  "visible",
  "focusKey",
  source.slice(start + "  useEffect(() => {".length, end),
);

function focusWith(activeElement: object, contains: (element: object) => boolean, visible = true): boolean {
  let focused = false;
  const container = {
    contains,
    focus: () => { focused = true; },
  };
  runEffect({ current: container }, { activeElement }, visible, null);
  return focused;
}

describe("main view master detail focus", () => {
  it("keeps the current field focused while the view state changes in place", () => {
    const input = {};
    for (let i = 0; i < 3; i++) {
      expect(focusWith(input, (element) => element === input)).toBe(false);
    }
  });

  it("focuses the panel when focus is outside it", () => {
    expect(focusWith({}, () => false)).toBe(true);
  });

  it("does not steal focus while the main view is hidden", () => {
    expect(focusWith({}, () => false, false)).toBe(false);
  });
});
