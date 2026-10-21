import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Exercise the actual focus effect without a browser or a running server.
// Updating a provider name changes `page` even though no navigation occurred.
const source = readFileSync("components/panels/ModelsConfigPanel.tsx", "utf8");
const focusCall = source.indexOf("containerRef.current?.focus");
const start = source.lastIndexOf("  useEffect(() => {", focusCall);
const end = source.indexOf("\n  }, [page]);", start);
const runEffect = new Function(
  "containerRef",
  "document",
  source.slice(start + "  useEffect(() => {".length, end),
);

describe("models config panel focus", () => {
  it("keeps the provider name input focused across consecutive draft edits", () => {
    const input = {};
    let focused: object = input;
    const container = {
      contains: (element: object) => element === input || element === container,
      focus: () => { focused = container; },
    };
    for (let i = 0; i < 3; i++) {
      runEffect({ current: container }, { activeElement: focused });
      expect(focused).toBe(input);
    }
  });

  it("focuses the panel when focus is outside it", () => {
    let focused = false;
    const container = {
      contains: () => false,
      focus: () => { focused = true; },
    };
    runEffect({ current: container }, { activeElement: {} });
    expect(focused).toBe(true);
  });
});
