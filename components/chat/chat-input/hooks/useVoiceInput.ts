"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserVoiceRecorder, isVoiceInputSupported } from "@/lib/client/voice-recorder-browser";
import { transcribeVoiceAudio } from "@/lib/client/voice-transcribe-io";
import type { VoiceRecorder, VoiceRecorderResult } from "@/lib/client/voice-recorder";
import {
  VOICE_INPUT_MIN_DURATION_MS,
  type VoiceInputErrorCode,
  type VoiceInputState,
} from "@/lib/shared/voice-input";

export interface VoiceRecorderFactoryOptions {
  onAutoStop?: (result: VoiceRecorderResult) => void;
}

export type VoiceRecorderFactory = (options: VoiceRecorderFactoryOptions) => VoiceRecorder;

export interface UseVoiceInputOptions {
  insertText: (text: string) => void;
  recorderFactory?: VoiceRecorderFactory;
  onError?: (code: VoiceInputErrorCode) => void;
}

export interface VoiceInputController {
  supported: boolean;
  phase: VoiceInputState["phase"];
  elapsedMs: number;
  level: number;
  toggle: () => Promise<void>;
  cancel: () => Promise<void>;
}

const IDLE: VoiceInputState = { phase: "idle", elapsedMs: 0, level: 0 };

export function useVoiceInput(options: UseVoiceInputOptions): VoiceInputController {
  const { insertText, recorderFactory, onError } = options;
  const autoStopRef = useRef<(result: VoiceRecorderResult) => void>(() => undefined);
  const [recorder] = useState<VoiceRecorder | null>(() => {
    const factoryOptions: VoiceRecorderFactoryOptions = {
      onAutoStop: (result) => autoStopRef.current(result),
    };
    if (recorderFactory) return recorderFactory(factoryOptions);
    return isVoiceInputSupported() ? createBrowserVoiceRecorder(factoryOptions) : null;
  });
  const [snapshot, setSnapshot] = useState<VoiceInputState>(() => recorder?.getSnapshot() ?? IDLE);
  const [transcribing, setTranscribing] = useState(false);
  const transcribingRef = useRef(false);
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!recorder) return;
    setSnapshot(recorder.getSnapshot());
    return recorder.subscribe(() => setSnapshot(recorder.getSnapshot()));
  }, [recorder]);

  const cancel = useCallback(async () => {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    transcribingRef.current = false;
    setTranscribing(false);
    await recorder?.cancel();
  }, [recorder]);

  useEffect(() => {
    return () => {
      inFlightRef.current?.abort();
      void recorder?.cancel();
    };
  }, [recorder]);

  const finish = useCallback(
    async (result: VoiceRecorderResult | null) => {
      if (!result || result.durationMs < VOICE_INPUT_MIN_DURATION_MS) return;
      if (transcribingRef.current) return;

      transcribingRef.current = true;
      setTranscribing(true);
      const controller = new AbortController();
      inFlightRef.current = controller;
      const outcome = await transcribeVoiceAudio(result.wav, { signal: controller.signal });
      if (inFlightRef.current !== controller) return;
      inFlightRef.current = null;
      transcribingRef.current = false;
      setTranscribing(false);

      if (!outcome.ok) {
        onError?.(outcome.code);
        return;
      }
      const transcript = outcome.text.trim();
      if (!transcript) {
        onError?.("empty_transcript");
        return;
      }
      insertText(transcript);
    },
    [insertText, onError],
  );

  useEffect(() => {
    autoStopRef.current = (result) => {
      void finish(result);
    };
  }, [finish]);

  const toggle = useCallback(async () => {
    if (!recorder || transcribingRef.current) return;
    const current = recorder.getSnapshot();
    if (current.phase === "idle") {
      try {
        await recorder.start();
      } catch (error) {
        const denied = error instanceof Error && error.name === "NotAllowedError";
        onError?.(denied ? "permission_denied" : "failed");
      }
      return;
    }
    if (current.phase !== "recording") return;

    await finish(await recorder.stop());
  }, [recorder, finish, onError]);

  return {
    supported: recorder !== null,
    phase: transcribing ? "transcribing" : snapshot.phase,
    elapsedMs: snapshot.elapsedMs,
    level: snapshot.level,
    toggle,
    cancel,
  };
}
