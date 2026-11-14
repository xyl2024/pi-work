"use client";

import { useSyncExternalStore } from "react";
import {
  synthesizeReadAloud,
  type ReadAloudSynthesisResult,
} from "@/lib/client/read-aloud-io";
import type { ReadAloudErrorCode } from "@/lib/shared/read-aloud";

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

export interface ReadAloudPlayerOptions {
  synthesize?: ReadAloudSynthesizer;
  createAudio?: (src: string) => ReadAloudAudio;
  createObjectUrl?: (audio: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export interface ReadAloudPlayer {
  toggle(key: string, text: string): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReadAloudSnapshot;
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

  async function start(key: string, text: string): Promise<void> {
    releaseAudio();
    abortSynthesis();
    const current = (token += 1);
    const controller = new AbortController();
    synthAbort = controller;
    patch({ phase: "synthesizing", key, error: null });

    let result: ReadAloudSynthesisResult;
    try {
      result = await synthesize(text, controller.signal);
    } catch {
      result = { ok: false, code: "failed" };
    }
    if (current !== token) return;
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
