// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "@/components/chat/composer/Composer";

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

describe("composer IME freeze", () => {
  it("does not take DOM text into the model until compositionend", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const drafts: { dirty: boolean }[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(Composer, {
        onSend: vi.fn(),
        onAbort: vi.fn(),
        isStreaming: false,
        onDraftChange: (draft) => drafts.push(draft),
      }));
    });

    const editor = container.querySelector(".composer-editable") as HTMLDivElement;
    expect(editor).toBeTruthy();
    expect(drafts.at(-1)?.dirty).toBe(false);

    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      editor.textContent = "ni";
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(drafts.at(-1)?.dirty).toBe(false);

    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(drafts.at(-1)?.dirty).toBe(true);
    expect(editor.textContent).toBe("ni");
  });
});
