import { describe, expect, it } from "vitest";
import { panelEscapeApplies } from "@/hooks/usePanelEscapeGuard";
import { createEscapeLayerStack } from "@/lib/client/escape-layer";

describe("escape layers", () => {
  it("reports nothing open on an empty stack", () => {
    const layers = createEscapeLayerStack();

    expect(layers.active()).toBeNull();
  });

  it("reports the innermost layer as the one that owns Escape", () => {
    const layers = createEscapeLayerStack();
    const releaseOuter = layers.push("dialog");
    layers.push("popover");

    expect(layers.active()).toBe("popover");

    layers.pop("popover");
    expect(layers.active()).toBe("dialog");

    releaseOuter();
    expect(layers.active()).toBeNull();
  });

  it("ignores a release that was already spent", () => {
    const layers = createEscapeLayerStack();
    const release = layers.push("popover");

    release();
    release();

    expect(layers.active()).toBeNull();
  });
});

describe("panel escape with a layer open", () => {
  it("leaves Escape to the layer in front of the panel", () => {
    expect(panelEscapeApplies({ visible: true, focusInsideOrBody: true, layerOpen: true })).toBe(false);
  });

  it("keeps handling Escape once every layer closes", () => {
    expect(panelEscapeApplies({ visible: true, focusInsideOrBody: true, layerOpen: false })).toBe(true);
  });
});
