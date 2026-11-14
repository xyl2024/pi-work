"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserVoiceRecorder, isVoiceInputSupported } from "@/lib/client/voice-recorder-browser";
import { transcribeVoiceAudio } from "@/lib/client/voice-transcribe-io";
import type { VoiceRecorder, VoiceRecorderResult } from "@/lib/client/voice-recorder";
import {
  VOICE_INPUT_MIN_DURATION_MS,
  voiceInputErrorCodeForRecorderError,
  type VoiceInputErrorCode,
  type VoiceInputState,
} from "@/lib/shared/voice-input";

export interface VoiceRecorderFactoryOptions {
  onAutoStop?: (result: VoiceRecorderResult) => void;
}

export type VoiceRecorderFactory = (options: VoiceRecorderFactoryOptions) => VoiceRecorder;

export interface UseVoiceInputOptions {
  insertText: (text: string) => void;
  sessionKey?: string | null;
  recorderFactory?: VoiceRecorderFactory;
}

export interface VoiceInputController {
  supported: boolean;
  phase: VoiceInputState["phase"];
  elapsedMs: number;
  level: number;
  error: VoiceInputErrorCode | null;
  toggle: () => Promise<void>;
  cancel: () => Promise<void>;
}

const IDLE: VoiceInputState = { phase: "idle", elapsedMs: 0, level: 0 };

export function useVoiceInput(options: UseVoiceInputOptions): VoiceInputController {
  const { insertText, sessionKey, recorderFactory } = options;
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
  const [error, setError] = useState<VoiceInputErrorCode | null>(null);
  const transcribingRef = useRef(false);
  const inFlightRef = useRef<AbortController | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    if (!recorder) return;
    setSnapshot(recorder.getSnapshot());
    return recorder.subscribe(() => setSnapshot(recorder.getSnapshot()));
  }, [recorder]);

  const cancel = useCallback(async () => {
    epochRef.current += 1;
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    transcribingRef.current = false;
    setTranscribing(false);
    setError(null);
    await recorder?.cancel();
  }, [recorder]);

  const sessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    if (sessionKeyRef.current === sessionKey) return;
    sessionKeyRef.current = sessionKey;
    void cancel();
  }, [sessionKey, cancel]);

  useEffect(() => {
    return () => {
      epochRef.current += 1;
      inFlightRef.current?.abort();
      inFlightRef.current = null;
      transcribingRef.current = false;
      void recorder?.cancel();
    };
  }, [recorder]);

  const transcribe = useCallback(
    async (result: VoiceRecorderResult | null, epoch: number) => {
      if (!result || result.durationMs < VOICE_INPUT_MIN_DURATION_MS) {
        transcribingRef.current = false;
        setTranscribing(false);
        return;
      }

      const controller = new AbortController();
      inFlightRef.current = controller;
      const outcome = await transcribeVoiceAudio(result.wav, { signal: controller.signal });
      if (epochRef.current !== epoch) return;

      inFlightRef.current = null;
      transcribingRef.current = false;
      setTranscribing(false);

      if (!outcome.ok) {
        setError(outcome.code);
        return;
      }
      const transcript = outcome.text.trim();
      if (!transcript) {
        setError("empty_transcript");
        return;
      }
      insertText(transcript);
    },
    [insertText],
  );

  useEffect(() => {
    autoStopRef.current = (result) => {
      if (transcribingRef.current) return;
      transcribingRef.current = true;
      setTranscribing(true);
      void transcribe(result, epochRef.current);
    };
  }, [transcribe]);

  const toggle = useCallback(async () => {
    if (!recorder || transcribingRef.current) return;
    const current = recorder.getSnapshot();
    if (current.phase === "idle") {
      setError(null);
      try {
        await recorder.start();
      } catch (recorderError) {
        setError(voiceInputErrorCodeForRecorderError(recorderError));
      }
      return;
    }
    if (current.phase !== "recording") return;

    const epoch = epochRef.current;
    transcribingRef.current = true;
    setTranscribing(true);
    const result = await recorder.stop();
    if (epochRef.current !== epoch) return;
    await transcribe(result, epoch);
  }, [recorder, transcribe]);

  return {
    supported: recorder !== null,
    phase: transcribing ? "transcribing" : snapshot.phase,
    elapsedMs: snapshot.elapsedMs,
    level: snapshot.level,
    error,
    toggle,
    cancel,
  };
}
