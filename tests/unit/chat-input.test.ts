// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/hooks/useI18n";
import { ChatInputAttachments } from "@/components/chat/ChatInputAttachments";
import { ChatInput } from "@/components/chat/ChatInput";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import type { SlashResource } from "@/lib/shared/slash-commands";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const skill: SlashResource = {
  source: "skill",
  name: "code-review",
  command: "skill:code-review",
  description: "Review changes",
  path: "/tmp/SKILL.md",
};

const image = {
  data: "base64",
  mimeType: "image/png",
  previewUrl: "data:image/png;base64,base64",
};

describe("ChatInputAttachments", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(images: typeof image[] = [], selectedSlashResource: SlashResource | null = null) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(ChatInputAttachments, {
            images,
            selectedSlashResource,
            onRemoveImage: () => undefined,
            onRemoveSlashResource: () => undefined,
          }),
        ),
      );
    });
  }

  it("renders images before the selected skill chip", () => {
    render([image], skill);

    const sections = Array.from(container.firstElementChild?.children ?? []);
    expect(sections[0]?.querySelector("img")).toBeTruthy();
    expect(sections[1]?.textContent).toContain("/skill:code-review");
    const row = container.firstElementChild;
    expect(row?.getAttribute("style")).toContain("position: absolute");
    expect(row?.getAttribute("style")).toContain("z-index: 10");
    expect(row?.getAttribute("style")).toContain("display: flex");
    expect(row?.getAttribute("style")).toContain("margin-bottom: 12px");
    expect(row?.getAttribute("style")).toContain("overflow-x: auto");
  });

  it("renders only the selected skill chip without an image list", () => {
    render([], skill);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("/skill:code-review");
  });

  it("renders only images without a skill chip", () => {
    render([image]);

    expect(container.querySelector("img")).not.toBeNull();
    expect(container.textContent).not.toContain("/skill:");
  });

  it("renders nothing without attachments", () => {
    render();

    expect(container.firstElementChild).toBeNull();
  });

  it("translates the composer placeholder", () => {
    expect(ZH_TRANSLATIONS["Type / to select a skill, @ to select a file"]).toBe("输入 / 选择技能，输入 @ 选择文件");
  });
});

describe("ChatInput builtin slash actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function renderInput(options: { enterToSend?: boolean } = {}) {
    const onSend = vi.fn();
    const onSlashAction = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(ChatInput, {
            onSend,
            onAbort: () => undefined,
            isStreaming: false,
            onSlashAction,
            enterToSend: options.enterToSend,
          }),
        ),
      );
    });
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea not rendered");
    return { textarea, onSend, onSlashAction };
  }

  function typeInto(textarea: HTMLTextAreaElement, text: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    for (let end = 1; end <= text.length; end += 1) {
      const next = text.slice(0, end);
      act(() => {
        valueSetter?.call(textarea, next);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
  }

  function pressEnter(textarea: HTMLTextAreaElement, init: KeyboardEventInit = {}) {
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));
    });
  }

  it("dispatches the usage action instead of sending on the exact command shortcut", () => {
    const { textarea, onSend, onSlashAction } = renderInput({ enterToSend: true });
    typeInto(textarea, "  /usage  ");

    pressEnter(textarea, { ctrlKey: true });

    expect(onSlashAction).toHaveBeenCalledWith("usage");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("dispatches the usage action when picked from the slash menu", () => {
    const { textarea, onSend, onSlashAction } = renderInput();
    typeInto(textarea, "/usage");

    expect(container.textContent).toContain("查询订阅模型服务用量");

    pressEnter(textarea);

    expect(onSlashAction).toHaveBeenCalledWith("usage");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("still sends the command with arguments as a normal message", () => {
    const { textarea, onSend, onSlashAction } = renderInput({ enterToSend: true });
    typeInto(textarea, "/usage opencode");

    pressEnter(textarea, { ctrlKey: true });

    expect(onSlashAction).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("/usage opencode", undefined);
  });
});
