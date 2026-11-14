// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/hooks/useI18n";
import { ChatInputAttachments } from "@/components/chat/ChatInputAttachments";
import { ChatInput } from "@/components/chat/ChatInput";
import { EN_TRANSLATIONS, ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import type { SlashResource } from "@/lib/shared/slash-commands";
import {
  createVoiceRecorder,
  type VoiceRecorder,
  type VoiceRecorderAdapter,
  type VoiceRecorderResult,
} from "@/lib/client/voice-recorder";
import { useVoiceInput, type VoiceRecorderFactory } from "@/components/chat/chat-input/hooks/useVoiceInput";
import {
  VOICE_INPUT_MAX_DURATION_MS,
  VOICE_INPUT_MIN_DURATION_MS,
  VOICE_INPUT_WARN_REMAINING_MS,
  type VoiceInputState,
} from "@/lib/shared/voice-input";

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
    if (container?.isConnected) act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  function createFakeRecorder(durationMs = 1200) {
    const listeners = new Set<() => void>();
    let snapshot: VoiceInputState = { phase: "idle", elapsedMs: 0, level: 0 };
    let autoStop: ((result: VoiceRecorderResult) => void) | null = null;
    let slowStop = false;
    let releasePendingStop: (() => void) | null = null;
    const emit = () => {
      for (const listener of listeners) listener();
    };
    const cancelSpy = vi.fn(async () => {
      snapshot = { phase: "idle", elapsedMs: 0, level: 0 };
      emit();
    });
    const recorder: VoiceRecorder = {
      async start() {
        snapshot = { phase: "recording", elapsedMs: 0, level: 0.2 };
        emit();
      },
      async stop() {
        snapshot = { phase: "idle", elapsedMs: 0, level: 0 };
        emit();
        if (slowStop) {
          slowStop = false;
          await new Promise<void>((resolve) => {
            releasePendingStop = resolve;
          });
        }
        return { wav: new Uint8Array([1, 2, 3, 4]), durationMs };
      },
      cancel: cancelSpy,
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
    return {
      recorder,
      cancelSpy,
      bindAutoStop(handler: ((result: VoiceRecorderResult) => void) | undefined) {
        autoStop = handler ?? null;
      },
      advance(elapsedMs: number, level: number) {
        snapshot = { ...snapshot, elapsedMs, level };
        emit();
      },
      holdNextStop() {
        slowStop = true;
      },
      releaseStop() {
        releasePendingStop?.();
        releasePendingStop = null;
      },
      autoStop(at = VOICE_INPUT_MAX_DURATION_MS) {
        snapshot = { phase: "idle", elapsedMs: 0, level: 0 };
        emit();
        autoStop?.({ wav: new Uint8Array([1, 2, 3, 4]), durationMs: at });
      },
    };
  }

  interface RenderOptions {
    sessionId?: string | null;
    suggestedPrompt?: string | null;
    userMessageHistory?: string[];
  }

  function renderInput(recorder: VoiceRecorder, factory?: VoiceRecorderFactory, options: RenderOptions = {}) {
    const onSend = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (next: RenderOptions) => {
      act(() => {
        root.render(
          createElement(
            I18nProvider,
            null,
            createElement(ChatInput, {
              onSend,
              onAbort: () => undefined,
              isStreaming: false,
              voiceRecorderFactory: factory ?? (() => recorder),
              ...next,
            }),
          ),
        );
      });
    };
    render(options);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea not rendered");
    return { textarea, onSend, rerender: render };
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

  function pressKey(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    });
  }

  async function startRecording() {
    await act(async () => {
      findButton("Start voice input")?.click();
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
    const { textarea, onSend } = renderInput(createFakeRecorder().recorder);
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

  it("shows the elapsed timer and live level while recording, then returns to the mic", async () => {
    const fake = createFakeRecorder(VOICE_INPUT_MIN_DURATION_MS - 1);
    renderInput(fake.recorder);

    await act(async () => {
      findButton("Start voice input")?.click();
    });
    const finishButton = findButton("Finish voice input");
    expect(finishButton?.textContent).toBe("00:00");

    act(() => fake.advance(65_000, 0.6));
    expect(finishButton?.textContent).toBe("01:05");
    expect(finishButton?.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("60");

    await act(async () => {
      finishButton?.click();
      await Promise.resolve();
    });

    expect(findButton("Start voice input")).not.toBeNull();
    expect(container.querySelector("[role=progressbar]")).toBeNull();
  });

  it("marks the timer when the recording nears the cap", async () => {
    const fake = createFakeRecorder(VOICE_INPUT_MIN_DURATION_MS - 1);
    renderInput(fake.recorder);

    await act(async () => {
      findButton("Start voice input")?.click();
    });
    const finishButton = findButton("Finish voice input");

    const warningLabel = `[aria-label="${ZH_TRANSLATIONS["Voice input nearing limit"]}"], [aria-label="Voice input nearing limit"]`;
    act(() => fake.advance(VOICE_INPUT_MAX_DURATION_MS - VOICE_INPUT_WARN_REMAINING_MS - 1, 0.2));
    expect(finishButton?.querySelector(warningLabel)).toBeNull();

    act(() => fake.advance(VOICE_INPUT_MAX_DURATION_MS - VOICE_INPUT_WARN_REMAINING_MS + 1, 0.2));
    expect(finishButton?.querySelector(warningLabel)).not.toBeNull();
  });

  it("transcribes automatically when the recorder reaches the cap", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ text: "long phrase" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fake = createFakeRecorder();
    const { textarea } = renderInput(fake.recorder, (options) => {
      fake.bindAutoStop(options.onAutoStop);
      return fake.recorder;
    });

    await act(async () => {
      findButton("Start voice input")?.click();
    });
    act(() => fake.advance(VOICE_INPUT_MAX_DURATION_MS - 1_000, 0.3));
    expect(findButton("Finish voice input")?.textContent).toBe("01:59");

    await act(async () => {
      fake.autoStop();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/voice/transcribe");
    expect(textarea.value).toBe("long phrase");
  });

  it("skips the request when the recording is shorter than the minimum", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const fake = createFakeRecorder(VOICE_INPUT_MIN_DURATION_MS - 1);
    renderInput(fake.recorder);

    await act(async () => {
      findButton("Start voice input")?.click();
    });
    await act(async () => {
      findButton("Finish voice input")?.click();
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(findButton("Start voice input")).not.toBeNull();
    expect(container.textContent).not.toContain(ZH_TRANSLATIONS["Didn't catch that, say it again"]);
  });

  function messageText(key: string) {
    return [
      ZH_TRANSLATIONS[key as keyof typeof ZH_TRANSLATIONS],
      EN_TRANSLATIONS[key as keyof typeof EN_TRANSLATIONS],
    ].filter(Boolean) as string[];
  }

  function countMessage(key: string) {
    const text = container.textContent ?? "";
    return messageText(key).reduce((total, message) => total + text.split(message).length - 1, 0);
  }

  async function runFailure(fetchResult: () => Promise<Response>) {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("fetch", vi.fn(fetchResult));
    const fake = createFakeRecorder();
    const { textarea } = renderInput(fake.recorder);
    typeInto(textarea, "keep this draft");
    await act(async () => {
      findButton("Start voice input")?.click();
    });
    await act(async () => {
      findButton("Finish voice input")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return textarea;
  }

  const failureCases: Array<{
    name: string;
    fetchResult: () => Promise<Response>;
    key: string;
  }> = [
    {
      name: "a missing DeepSeek key",
      fetchResult: async () => new Response(JSON.stringify({ error: "missing_key" }), { status: 409 }),
      key: "DeepSeek API key is not configured",
    },
    {
      name: "an empty transcript",
      fetchResult: async () => new Response(JSON.stringify({ text: "" }), { status: 200 }),
      key: "Didn't catch that, say it again",
    },
    {
      name: "rate limiting",
      fetchResult: async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
      key: "Voice input is busy, try again",
    },
    {
      name: "invalid audio",
      fetchResult: async () => new Response(JSON.stringify({ error: "invalid_audio" }), { status: 400 }),
      key: "Voice input failed",
    },
    {
      name: "a busy service",
      fetchResult: async () => new Response(JSON.stringify({ error: "busy" }), { status: 503 }),
      key: "Voice input is busy, try again",
    },
    {
      name: "an upstream timeout",
      fetchResult: async () => new Response(JSON.stringify({ error: "timeout" }), { status: 504 }),
      key: "Voice input timed out",
    },
    {
      name: "a client timeout",
      fetchResult: async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
      key: "Voice input timed out",
    },
  ];

  it.each(failureCases)("shows one neutral message for $name and resets the button", async ({ fetchResult, key }) => {
    const textarea = await runFailure(fetchResult);

    expect(countMessage(key)).toBe(1);
    expect(container.textContent).not.toContain("secret upstream detail");
    expect(findButton("Start voice input")).not.toBeNull();
    expect(findButton("Transcribing...")).toBeNull();
    expect(textarea.value).toBe("keep this draft");
  });

  it("shows the permission message when microphone access is denied", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    const fake = createFakeRecorder();
    vi.spyOn(fake.recorder, "start").mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { textarea } = renderInput(fake.recorder);
    typeInto(textarea, "keep this draft");

    await act(async () => {
      findButton("Start voice input")?.click();
      await Promise.resolve();
    });

    expect(countMessage("Microphone access was denied")).toBe(1);
    expect(findButton("Start voice input")).not.toBeNull();
    expect(textarea.value).toBe("keep this draft");
  });

  it("clears the message once a new recording starts", async () => {
    await runFailure(async () => new Response(JSON.stringify({ error: "busy" }), { status: 503 }));
    expect(countMessage("Voice input is busy, try again")).toBe(1);

    await act(async () => {
      findButton("Start voice input")?.click();
    });

    expect(countMessage("Voice input is busy, try again")).toBe(0);
  });
  it("toggles recording from the focused composer with the meta shortcut", async () => {
    const { textarea } = renderInput(createFakeRecorder().recorder);
    textarea.focus();

    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ariaLabelMatches(findButton("Finish voice input"), "Finish voice input")).toBe(true);
  });

  it("toggles recording from outside the composer with the control shortcut", async () => {
    renderInput(createFakeRecorder().recorder);

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
    const { textarea, onSend } = renderInput(createFakeRecorder().recorder);

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
    const recorder = createFakeRecorder().recorder;
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

  it("cancels the recording on escape without transcribing or touching the draft", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const fake = createFakeRecorder();
    const { textarea } = renderInput(fake.recorder);
    typeInto(textarea, "draft");

    await startRecording();
    expect(findButton("Finish voice input")).not.toBeNull();

    pressKey(textarea, "Escape");
    await act(async () => {
      await Promise.resolve();
    });

    expect(fake.cancelSpy).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(textarea.value).toBe("draft");
    expect(findButton("Start voice input")).not.toBeNull();
  });

  it("drops the transcription when escape lands while the recorder is releasing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const fake = createFakeRecorder();
    const { textarea } = renderInput(fake.recorder);
    typeInto(textarea, "draft");

    await startRecording();
    fake.holdNextStop();
    await act(async () => {
      findButton("Finish voice input")?.click();
      await Promise.resolve();
    });

    pressKey(textarea, "Escape");
    await act(async () => {
      await Promise.resolve();
    });
    expect(fake.cancelSpy).toHaveBeenCalled();

    await act(async () => {
      fake.releaseStop();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(textarea.value).toBe("draft");
    expect(findButton("Start voice input")).not.toBeNull();
  });

  it("drops the transcription when the session changes while the recorder is releasing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const fake = createFakeRecorder();
    const { rerender } = renderInput(fake.recorder, undefined, { sessionId: "session-a" });

    await startRecording();
    fake.holdNextStop();
    await act(async () => {
      findButton("Finish voice input")?.click();
      await Promise.resolve();
    });

    act(() => rerender({ sessionId: "session-b" }));
    await act(async () => {
      fake.releaseStop();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fake.cancelSpy).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(ZH_TRANSLATIONS["Didn't catch that, say it again"]);
    expect(findButton("Start voice input")).not.toBeNull();
  });

  it("aborts the in-flight transcription on escape and never inserts the late response", async () => {
    let finishTranscription: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => {
        finishTranscription = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fake = createFakeRecorder();
    const { textarea } = renderInput(fake.recorder);

    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    dispatchShortcut(textarea, { metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(findButton("Transcribing...")).not.toBeNull();
    const signal = fetchMock.mock.calls[0][1]?.signal;

    pressKey(textarea, "Escape");
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      finishTranscription?.(new Response(JSON.stringify({ text: "late voice text" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(textarea.value).toBe("");
    expect(findButton("Start voice input")).not.toBeNull();
  });

  it("cancels the recording when the session changes", async () => {
    const fake = createFakeRecorder();
    const { rerender } = renderInput(fake.recorder, undefined, { sessionId: "session-a" });

    await startRecording();
    expect(findButton("Finish voice input")).not.toBeNull();

    act(() => rerender({ sessionId: "session-b" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fake.cancelSpy).toHaveBeenCalled();
    expect(findButton("Start voice input")).not.toBeNull();
  });

  it("cancels the recording when the composer unmounts", async () => {
    const fake = createFakeRecorder();
    renderInput(fake.recorder);

    await startRecording();
    act(() => root.unmount());
    container.remove();

    expect(fake.cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("discards the recording when sending an empty draft", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const fake = createFakeRecorder();
    const { textarea, onSend } = renderInput(fake.recorder);

    await startRecording();
    pressKey(textarea, "Enter", { ctrlKey: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fake.cancelSpy).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findButton("Start voice input")).not.toBeNull();
  });

  it("sends the existing draft on enter while recording and never transcribes", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const fake = createFakeRecorder();
    const { textarea, onSend } = renderInput(fake.recorder);
    typeInto(textarea, "hello");

    await startRecording();
    pressKey(textarea, "Enter", { ctrlKey: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith("hello", undefined);
    expect(fake.cancelSpy).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
    expect(findButton("Start voice input")).not.toBeNull();
  });

  it("adopts the suggested prompt with tab while recording", async () => {
    const fake = createFakeRecorder();
    const { textarea } = renderInput(fake.recorder, undefined, { suggestedPrompt: "Explain this repo" });

    await startRecording();
    pressKey(textarea, "Tab");

    expect(textarea.value).toBe("Explain this repo");
    expect(findButton("Finish voice input")).not.toBeNull();
  });

  it("walks the message history with arrow up while recording", async () => {
    const fake = createFakeRecorder();
    const { textarea } = renderInput(fake.recorder, undefined, { userMessageHistory: ["older question"] });

    await startRecording();
    pressKey(textarea, "ArrowUp");

    expect(textarea.value).toBe("older question");
    expect(findButton("Finish voice input")).not.toBeNull();
  });

  it("closes the slash menu on escape before cancelling the recording", async () => {
    const fake = createFakeRecorder();
    const { textarea } = renderInput(fake.recorder);

    await startRecording();
    typeInto(textarea, "/usage");
    expect(container.textContent).toContain("查询订阅模型服务用量");

    pressKey(textarea, "Escape");

    expect(container.textContent).not.toContain("查询订阅模型服务用量");
    expect(fake.cancelSpy).not.toHaveBeenCalled();
    expect(findButton("Finish voice input")).not.toBeNull();
  });

  it("does not render the mic button when the browser cannot capture audio", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(ChatInput, {
            onSend: vi.fn(),
            onAbort: () => undefined,
            isStreaming: false,
          }),
        ),
      );
    });

    expect(findButton("Start voice input")).toBeNull();
    expect(container.textContent).not.toContain(ZH_TRANSLATIONS["Start voice input"]);
    expect(container.textContent).not.toContain("语音输入");
  });

  it.each([
    [
      "the microphone is denied",
      new DOMException("denied", "NotAllowedError"),
      "Microphone access was denied",
    ],
    ["the capture pipeline breaks", new Error("boom"), "Voice input failed"],
  ])("shows one neutral message and stays idle when %s", async (_name, error, key) => {
    const adapter: VoiceRecorderAdapter = {
      async open() {
        throw error;
      },
      async close() {},
    };
    const recorder = createVoiceRecorder({ adapter });
    const { textarea } = renderInput(recorder);
    typeInto(textarea, "keep this draft");

    await act(async () => {
      findButton("Start voice input")?.click();
      await Promise.resolve();
    });

    expect(countMessage(key)).toBe(1);
    expect(findButton("Start voice input")).not.toBeNull();
    expect(findButton("Finish voice input")).toBeNull();
    expect(textarea.value).toBe("keep this draft");
  });

  it("drops a late failure after cancel without showing a message", async () => {
    let settle: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      settle = resolve;
    })));
    const fake = createFakeRecorder();
    const cancelRef: { current: (() => Promise<void>) | null } = { current: null };

    function Harness() {
      const voice = useVoiceInput({
        insertText: () => undefined,
        recorderFactory: () => fake.recorder,
      });
      cancelRef.current = voice.cancel;
      return createElement(
        "div",
        null,
        createElement("button", { "aria-label": "voice-toggle", onClick: () => void voice.toggle() }),
        voice.error ? createElement("p", { "data-error": voice.error }, voice.error) : null,
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(I18nProvider, null, createElement(Harness)));
    });
    const toggle = () => container.querySelector<HTMLButtonElement>("[aria-label=voice-toggle]");

    await act(async () => {
      toggle()?.click();
    });
    await act(async () => {
      toggle()?.click();
      await Promise.resolve();
    });
    expect(container.querySelector("p")).toBeNull();

    await act(async () => {
      await cancelRef.current?.();
      settle?.(new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.querySelector("[data-error]")).toBeNull();
  });
});
