// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "@/components/chat/composer/Composer";
import type { ComposerHandle } from "@/lib/client/composer/types";

vi.mock("@/hooks/useI18n", () => ({ useI18n: () => ({ t: (s: string) => s }) }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

async function mountComposer(handle: React.RefObject<ComposerHandle | null>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: () => `blob:${Math.random().toString(36).slice(2)}`,
    revokeObjectURL: () => {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Composer, {
      ref: handle,
      onSend: vi.fn(),
      onAbort: vi.fn(),
      isStreaming: false,
    }));
  });
  return container.querySelector(".composer-editable") as HTMLDivElement;
}

describe("composer images during composition", () => {
  it("defers inserting encoded images until compositionend", async () => {
    const handle = createRef<ComposerHandle>();
    const editor = await mountComposer(handle);
    const file = new File([new Uint8Array([1, 2, 3])], "cat.png", { type: "image/png" });

    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      handle.current?.addImages([file]);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(editor.querySelector("[data-composer-kind='image']")).toBeNull();

    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(editor.querySelector("[data-composer-kind='image']")).toBeTruthy();
  });
});

describe("composer imperative insertIfEmpty", () => {
  it("keeps existing image chips and inserts the content at the start", async () => {
    const handle = createRef<ComposerHandle>();
    const editor = await mountComposer(handle);
    const file = new File([new Uint8Array([1, 2, 3])], "cat.png", { type: "image/png" });

    await act(async () => {
      handle.current?.addImages([file]);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const imageChip = editor.querySelector("[data-composer-kind='image']");
    expect(imageChip).toBeTruthy();

    await act(async () => {
      handle.current?.insertIfEmpty("hello");
    });
    expect(editor.querySelector("[data-composer-kind='image']")).toBeTruthy();
    expect(editor.firstChild?.textContent).toBe("hello");
    expect(editor.querySelector("[data-composer-kind='image']")?.previousSibling?.textContent)
      .toBe("hello");
  });
});
