import { describe, expect, it } from "vitest";
import { panelEscapeApplies } from "@/hooks/usePanelEscapeGuard";

describe("panel escape guard", () => {
  it("stays out of the way while the panel is hidden", () => {
    expect(panelEscapeApplies({ visible: false, focusInsideOrBody: true })).toBe(false);
  });

  it("handles Escape when the panel is in front and focus is loose or inside it", () => {
    expect(panelEscapeApplies({ visible: true, focusInsideOrBody: true })).toBe(true);
  });

  it("leaves Escape to the focused element when focus lives outside the panel", () => {
    expect(panelEscapeApplies({ visible: true, focusInsideOrBody: false })).toBe(false);
  });
});
