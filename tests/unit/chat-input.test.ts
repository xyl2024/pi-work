// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/hooks/useI18n";
import { ChatInputAttachments } from "@/components/chat/ChatInputAttachments";
import { ChatInput } from "@/components/chat/ChatInput";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import type { SlashResource } from "@/lib/shared/slash-commands";
import type { VoiceRecorder } from "@/lib/client/voice-recorder";
import type { VoiceInputState } from "@/lib/shared/voice-input";

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

describe("ChatInput voice input", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  function createFakeRecorder() {
    const listeners = new Set<() => void>();
    let snapshot: VoiceInputState = { phase: "idle", elapsedMs: 0, level: 0 };
    const emit = () => {
      for (const listener of listeners) listener();
    };
    const recorder: VoiceRecorder = {
      async start() {
        snapshot = { phase: "recording", elapsedMs: 0, level: 0.2 };
        emit();
      },
      async stop() {
        snapshot = { phase: "idle", elapsedMs: 1200, level: 0 };
        emit();
        return { wav: new Uint8Array([1, 2, 3, 4]), durationMs: 1200 };
      },
      async cancel() {
        snapshot = { phase: "idle", elapsedMs: 0, level: 0 };
        emit();
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot() {
        return snapshot;
      },
    };
    return recorder;
  }

  function renderInput(recorder: VoiceRecorder) {
    const onSend = vi.fn();
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
            voiceRecorderFactory: () => recorder,
          }),
        ),
      );
    });
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea not rendered");
    return { textarea, onSend };
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

  function findButton(labelKey: string) {
    const labels: string[] = [ZH_TRANSLATIONS[labelKey as keyof typeof ZH_TRANSLATIONS], labelKey];
    return (
      Array.from(container.querySelectorAll("button")).find((button) =>
        labels.includes(button.getAttribute("aria-label") ?? ""),
      ) ?? null
    );
  }

  function ariaLabelMatches(button: Element | null, labelKey: string) {
    return button?.getAttribute("aria-label") === ZH_TRANSLATIONS[labelKey as keyof typeof ZH_TRANSLATIONS] ||
      button?.getAttribute("aria-label") === labelKey;
  }

  function dispatchShortcut(target: EventTarget, init: KeyboardEventInit = {}) {
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: "m", shiftKey: true, bubbles: true, cancelable: true, ...init }),
      );
    });
  }

  it("inserts the transcript at the cursor without sending or touching the rest", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return setTimeout(() => callback(0), 0);
    });
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ text: "voice text" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { textarea, onSend } = renderInput(createFakeRecorder());
    typeInto(textarea, "Hello  world");
    act(() => {
      textarea.setSelectionRange(6, 6);
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
    });

    const startButton = findButton("Start voice input");
    expect(startButton).not.toBeNull();
    await act(async () => {
      startButton?.click();
    });

    const finishButton = findButton("Finish voice input");
    expect(finishButton).not.toBeNull();
    await act(async () => {
      finishButton?.click();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestedUrl] = fetchMock.mock.calls[0];
    expect(String(requestedUrl)).toBe("/api/voice/transcribe");
    expect(textarea.value).toBe("Hello voice text world");
    expect(textarea.selectionStart).toBe(6 + "voice text".length);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("toggles recording from the focused composer with the meta shortcut", async () => {
    const { textarea } = renderInput(createFakeRecorder());
    textarea.focus();

    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ariaLabelMatches(findButton("Finish voice input"), "Finish voice input")).toBe(true);
  });

  it("toggles recording from outside the composer with the control shortcut", async () => {
    renderInput(createFakeRecorder());

    dispatchShortcut(window, { ctrlKey: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ariaLabelMatches(findButton("Finish voice input"), "Finish voice input")).toBe(true);
  });

  it("stops and transcribes when pressed again while recording", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return setTimeout(() => callback(0), 0);
    });
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ text: "voice text" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { textarea, onSend } = renderInput(createFakeRecorder());

    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("voice text");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("labels each state and ignores the shortcut while transcribing", async () => {
    let finishTranscription: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => {
        finishTranscription = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const recorder = createFakeRecorder();
    const startSpy = vi.spyOn(recorder, "start");
    const { textarea } = renderInput(recorder);

    expect(ariaLabelMatches(findButton("Start voice input"), "Start voice input")).toBe(true);
    expect(findButton("Start voice input")?.getAttribute("title")).toContain("⌘⇧M");
    expect(findButton("Start voice input")?.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+M Control+Shift+M");

    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(ariaLabelMatches(findButton("Finish voice input"), "Finish voice input")).toBe(true);

    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(ariaLabelMatches(findButton("Transcribing..."), "Transcribing...")).toBe(true);

    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishTranscription?.(new Response(JSON.stringify({ text: "voice text" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("voice text");
  });
});
