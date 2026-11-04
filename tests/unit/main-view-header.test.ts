import { describe, expect, it, vi } from "vitest";
import {
  getMainViewHeader,
  setMainViewHeader,
  subscribeMainViewHeader,
} from "@/lib/client/main-view-header";

describe("main view header injection", () => {
  it("starts with no title and no back override", () => {
    expect(getMainViewHeader()).toEqual({ titleKey: null, onBack: null });
  });

  it("carries an injected title and back override", () => {
    const onBack = () => {};
    setMainViewHeader({ titleKey: "New task", onBack });
    expect(getMainViewHeader()).toEqual({ titleKey: "New task", onBack });
    setMainViewHeader(null);
  });

  it("clears the title when the injector goes away", () => {
    setMainViewHeader({ titleKey: "Edit task", onBack: null });
    setMainViewHeader(null);
    expect(getMainViewHeader()).toEqual({ titleKey: null, onBack: null });
  });

  it("notifies subscribers only when the header actually changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMainViewHeader(listener);
    const onBack = () => {};
    setMainViewHeader({ titleKey: "New task", onBack });
    setMainViewHeader({ titleKey: "New task", onBack });
    expect(listener).toHaveBeenCalledTimes(1);
    setMainViewHeader({ titleKey: "Edit task", onBack });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setMainViewHeader(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getMainViewHeader()).toEqual({ titleKey: null, onBack: null });
  });
});
