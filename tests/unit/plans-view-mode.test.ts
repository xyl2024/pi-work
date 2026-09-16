import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_VIEW_MODE_STORAGE_KEY,
  readPlanViewMode,
  writePlanViewMode,
} from "@/lib/client/plans-view-mode";

/**
 * The appearance mode is a browser-local preference (#48), so the interesting
 * behaviour is exactly what happens when localStorage is missing, garbled or
 * throwing. The module reads `window` at call time, so a stubbed global is
 * enough — no jsdom and no component rendering involved.
 */

/** Minimal in-memory Storage stand-in: the module only calls get/setItem. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function stubWindow(storage: Storage | null): void {
  vi.stubGlobal("window", storage === null ? undefined : { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plans view mode storage", () => {
  it("defaults to compact when nothing has been stored", () => {
    stubWindow(memoryStorage());
    expect(readPlanViewMode()).toBe("compact");
  });

  it("round-trips a chosen mode so a reload / reopened panel keeps it", () => {
    const storage = memoryStorage();
    stubWindow(storage);
    writePlanViewMode("timeline");
    expect(storage.getItem(PLAN_VIEW_MODE_STORAGE_KEY)).toBe("timeline");
    expect(readPlanViewMode()).toBe("timeline");
    writePlanViewMode("cards");
    expect(readPlanViewMode()).toBe("cards");
  });

  it("falls back to compact for a garbled stored value", () => {
    stubWindow(memoryStorage({ [PLAN_VIEW_MODE_STORAGE_KEY]: "board" }));
    expect(readPlanViewMode()).toBe("compact");
  });

  it("survives storage that throws (private mode / quota) in both directions", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    stubWindow(throwing);
    expect(readPlanViewMode()).toBe("compact");
    expect(() => writePlanViewMode("timeline")).not.toThrow();
  });

  it("defaults when there is no window at all", () => {
    stubWindow(null);
    expect(readPlanViewMode()).toBe("compact");
    expect(() => writePlanViewMode("cards")).not.toThrow();
  });
});
