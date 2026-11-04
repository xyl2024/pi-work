import { describe, expect, it } from "vitest";
import { MAIN_VIEW_SPECS, type MainViewKind } from "@/lib/shared/mainView";
import { resolveMainViewNav } from "@/lib/shared/main-view-nav";

const REGISTRY_ORDER = MAIN_VIEW_SPECS.map((spec) => spec.kind);

function allKinds(count: number): MainViewKind[] {
  return Array.from({ length: count }, (_, index) => `kind${index}` as MainViewKind);
}

describe("resolveMainViewNav", () => {
  it("takes the first rows in registration order when nothing is active", () => {
    const kinds = [...REGISTRY_ORDER, ...allKinds(4)];
    const layout = resolveMainViewNav({ kinds, active: null, availableRows: 3 });

    expect(layout.visible).toEqual(kinds.slice(0, 3));
    expect(layout.overflow).toEqual(kinds.slice(3));
    expect(layout.expandedActive).toBe(null);
  });

  it("floats an active item out of overflow and displaces the last visible row", () => {
    const kinds = [...REGISTRY_ORDER, ...allKinds(4)];
    const active = kinds[4];
    const layout = resolveMainViewNav({ kinds, active, availableRows: 3 });

    expect(layout.visible).toEqual([kinds[0], kinds[1], active]);
    expect(layout.visible).not.toContain(kinds[2]);
    expect(layout.overflow).toContain(kinds[2]);
    expect(layout.overflow).not.toContain(active);
    expect(layout.expandedActive).toBe(active);
  });

  it("does not overflow when the kinds fit the available rows", () => {
    const kinds = [...REGISTRY_ORDER, ...allKinds(2)];
    const layout = resolveMainViewNav({ kinds, active: kinds[2], availableRows: 3 });

    expect(layout.visible).toEqual(kinds);
    expect(layout.overflow).toEqual([]);
    expect(layout.expandedActive).toBe(null);
  });

  it("keeps visible and overflow a partition of the input set", () => {
    const kinds = [...REGISTRY_ORDER, ...allKinds(6)];
    for (const active of [null, kinds[0], kinds[3], kinds[6]]) {
      const layout = resolveMainViewNav({ kinds, active, availableRows: 3 });
      const union = [...layout.visible, ...layout.overflow];

      expect(union).toHaveLength(kinds.length);
      expect(new Set(union)).toEqual(new Set(kinds));
    }
  });

  it("puts every kind into overflow when no rows are available", () => {
    const kinds = [...REGISTRY_ORDER, ...allKinds(2)];
    const layout = resolveMainViewNav({ kinds, active: kinds[2], availableRows: 0 });

    expect(layout.visible).toEqual([]);
    expect(layout.overflow).toEqual(kinds);
    expect(layout.expandedActive).toBe(kinds[2]);
  });
});
