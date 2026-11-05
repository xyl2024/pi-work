// @vitest-environment jsdom
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMainViewHeader,
  setMainViewHeader,
  subscribeMainViewHeader,
  useInjectMainViewHeader,
  useMainViewHeader,
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

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function mount(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root?.render(element);
  });
}

function FormPage({ tick, onBack }: { tick: number; onBack: () => void }) {
  useInjectMainViewHeader(`Title ${tick}`, onBack);
  return null;
}

describe("main view header injection from a form page", () => {
  it("stops re-registering when the header host re-renders with a fresh back handler", async () => {
    const back = vi.fn();
    function Shell() {
      const header = useMainViewHeader();
      const [tick, setTick] = useState(0);
      return createElement(
        "div",
        null,
        createElement(
          "button",
          {
            id: "host",
            onClick: () => header.onBack?.(),
            "data-title": header.titleKey ?? "",
          },
          header.titleKey ?? "none",
        ),
        createElement("button", { id: "bump", onClick: () => setTick((n) => n + 1) }, "bump"),
        createElement(FormPage, { tick, onBack: () => back() }),
      );
    }

    await mount(createElement(Shell));
    expect(container?.querySelector("#host")?.getAttribute("data-title")).toBe("Title 0");

    const bump = container?.querySelector<HTMLButtonElement>("#bump");
    for (let i = 0; i < 3; i += 1) await act(async () => bump?.click());
    expect(container?.querySelector("#host")?.getAttribute("data-title")).toBe("Title 3");

    await act(async () => container?.querySelector<HTMLButtonElement>("#host")?.click());
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("clears the header when the form page unmounts", async () => {
    function OnlyPage() {
      useInjectMainViewHeader("Only page", () => {});
      return null;
    }
    await mount(createElement(OnlyPage));
    expect(getMainViewHeader().titleKey).toBe("Only page");
    await act(async () => root?.unmount());
    root = undefined;
    expect(getMainViewHeader()).toEqual({ titleKey: null, onBack: null });
  });
});
