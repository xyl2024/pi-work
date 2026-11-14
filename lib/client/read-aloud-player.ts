"use client";

import { useSyncExternalStore } from "react";
import {
  synthesizeReadAloud,
  type ReadAloudSynthesisResult,
} from "@/lib/client/read-aloud-io";
import {
  READ_ALOUD_RETRY_DELAY_MS,
  isReadAloudRetryableError,
  type ReadAloudErrorCode,
} from "@/lib/shared/read-aloud";

export type ReadAloudPhase = "idle" | "synthesizing" | "playing" | "paused";

export interface ReadAloudSnapshot {
  phase: ReadAloudPhase;
  key: string | null;
  error: ReadAloudErrorCode | null;
  errorKey: string | null;
  errorId: number;
}

export interface ReadAloudAudio {
  src: string;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

export type ReadAloudSynthesizer = (
  text: string,
  signal: AbortSignal,
) => Promise<ReadAloudSynthesisResult>;

export type ReadAloudRetryWait = (signal: AbortSignal) => Promise<boolean>;

export interface ReadAloudPlayerOptions {
  synthesize?: ReadAloudSynthesizer;
  createAudio?: (src: string) => ReadAloudAudio;
  createObjectUrl?: (audio: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  waitForRetry?: ReadAloudRetryWait;
}

export interface ReadAloudPlayer {
  toggle(key: string, text: string): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReadAloudSnapshot;
}

function defaultWaitForRetry(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, READ_ALOUD_RETRY_DELAY_MS);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const IDLE: ReadAloudSnapshot = {
  phase: "idle",
  key: null,
  error: null,
  errorKey: null,
  errorId: 0,
};

export function createReadAloudPlayer(options: ReadAloudPlayerOptions = {}): ReadAloudPlayer {
  const synthesize = options.synthesize ?? ((text, signal) => synthesizeReadAloud(text, { signal }));
  const createAudio = options.createAudio ?? ((src: string) => new Audio(src) as ReadAloudAudio);
  const createObjectUrl = options.createObjectUrl ?? ((audio: Blob) => URL.createObjectURL(audio));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;

  const listeners = new Set<() => void>();
  let snapshot: ReadAloudSnapshot = IDLE;
  let audio: ReadAloudAudio | null = null;
  let audioUrl: string | null = null;
  let synthAbort: AbortController | null = null;
  let token = 0;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function patch(next: Partial<ReadAloudSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    emit();
  }

  function releaseAudio(): void {
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio = null;
    }
    if (audioUrl) {
      revokeObjectUrl(audioUrl);
      audioUrl = null;
    }
  }

  function abortSynthesis(): void {
    synthAbort?.abort();
    synthAbort = null;
  }

  function fail(code: ReadAloudErrorCode): void {
    token += 1;
    abortSynthesis();
    releaseAudio();
    patch({
      phase: "idle",
      key: null,
      error: code,
      errorKey: snapshot.key,
      errorId: snapshot.errorId + 1,
    });
  }

  async function runSynthesis(text: string, signal: AbortSignal): Promise<ReadAloudSynthesisResult> {
    try {
      return await synthesize(text, signal);
    } catch {
      return { ok: false, code: "network" };
    }
  }

  async function start(key: string, text: string): Promise<void> {
    releaseAudio();
    abortSynthesis();
    const current = (token += 1);
    const controller = new AbortController();
    synthAbort = controller;
    patch({ phase: "synthesizing", key, error: null });

    let result = await runSynthesis(text, controller.signal);
    if (current !== token) return;

    if (!result.ok && isReadAloudRetryableError(result.code)) {
      const retry = await waitForRetry(controller.signal);
      if (current !== token) return;
      if (!retry) {
        synthAbort = null;
        return;
      }
      patch({ phase: "synthesizing", key, error: null });
      result = await runSynthesis(text, controller.signal);
      if (current !== token) return;
    }

    synthAbort = null;
    if (!result.ok) {
      fail(result.code);
      return;
    }

    const url = createObjectUrl(result.audio);
    if (current !== token) {
      revokeObjectUrl(url);
      return;
    }

    const element = createAudio(url);
    element.onended = () => {
      if (current !== token) return;
      token += 1;
      releaseAudio();
      patch({ phase: "idle", key: null });
    };
    element.onerror = () => {
      if (current !== token) return;
      fail("failed");
    };

    audio = element;
    audioUrl = url;
    patch({ phase: "playing", key });
    element.play().catch(() => {
      if (current !== token) return;
      fail("failed");
    });
  }

  return {
    toggle(key, text) {
      if (snapshot.phase === "synthesizing" && snapshot.key === key) return;
      if (
        audio &&
        (snapshot.phase === "playing" || snapshot.phase === "paused") &&
        snapshot.key === key
      ) {
        if (snapshot.phase === "playing") {
          audio.pause();
          patch({ phase: "paused" });
          return;
        }
        patch({ phase: "playing" });
        audio.play().catch(() => {
          if (snapshot.phase === "playing" && snapshot.key === key) fail("failed");
        });
        return;
      }
      void start(key, text);
    },

    stop() {
      token += 1;
      abortSynthesis();
      releaseAudio();
      patch({ phase: "idle", key: null, error: null });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return snapshot;
    },
  };
}

export const readAloudPlayer = createReadAloudPlayer();

function getServerSnapshot(): ReadAloudSnapshot {
  return IDLE;
}

export function useReadAloud(): ReadAloudSnapshot {
  return useSyncExternalStore(
    readAloudPlayer.subscribe,
    readAloudPlayer.getSnapshot,
    getServerSnapshot,
  );
}
