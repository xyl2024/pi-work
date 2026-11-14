import {
  encodePcm16Wav,
  VOICE_INPUT_MAX_DURATION_MS,
  VOICE_INPUT_SAMPLE_RATE,
  type VoiceInputState,
} from "@/lib/shared/voice-input";

export interface VoiceRecorderAdapterHandlers {
  onSamples: (samples: Int16Array) => void;
  onLevel: (level: number) => void;
}

export interface VoiceRecorderAdapter {
  open(handlers: VoiceRecorderAdapterHandlers): Promise<void>;
  close(): Promise<void>;
}

export interface VoiceRecorderResult {
  wav: Uint8Array;
  durationMs: number;
}

export type VoiceRecorderSnapshot = VoiceInputState;

export interface VoiceRecorder {
  start(): Promise<void>;
  stop(): Promise<VoiceRecorderResult | null>;
  cancel(): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): VoiceRecorderSnapshot;
}

export interface VoiceRecorderOptions {
  adapter: VoiceRecorderAdapter;
  now?: () => number;
  onAutoStop?: (result: VoiceRecorderResult) => void;
}

const TICK_MS = 100;

export function createVoiceRecorder(options: VoiceRecorderOptions): VoiceRecorder {
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  let snapshot: VoiceRecorderSnapshot = { phase: "idle", elapsedMs: 0, level: 0 };
  let chunks: Int16Array[] = [];
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function patch(next: VoiceRecorderSnapshot): void {
    snapshot = next;
    emit();
  }

  function clearTimer(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function elapsed(): number {
    return Math.max(0, now() - startedAt);
  }

  async function stop(): Promise<VoiceRecorderResult | null> {
    if (snapshot.phase !== "recording") return null;
    clearTimer();
    const durationMs = elapsed();
    await options.adapter.close();
    const wav = encodePcm16Wav(chunks, VOICE_INPUT_SAMPLE_RATE);
    chunks = [];
    patch({ phase: "idle", elapsedMs: 0, level: 0 });
    return { wav, durationMs };
  }

  return {
    async start() {
      if (snapshot.phase !== "idle") return;
      await options.adapter.open({
        onSamples(samples) {
          if (snapshot.phase !== "recording") return;
          chunks.push(samples);
        },
        onLevel(level) {
          if (snapshot.phase !== "recording") return;
          patch({ ...snapshot, level });
        },
      });
      chunks = [];
      startedAt = now();
      patch({ phase: "recording", elapsedMs: 0, level: 0 });
      timer = setInterval(() => {
        if (snapshot.phase !== "recording") return;
        const elapsedMs = elapsed();
        if (elapsedMs >= VOICE_INPUT_MAX_DURATION_MS) {
          void stop().then((result) => {
            if (result) options.onAutoStop?.(result);
          });
          return;
        }
        patch({ ...snapshot, elapsedMs });
      }, TICK_MS);
    },

    stop,

    async cancel() {
      if (snapshot.phase !== "recording") return;
      clearTimer();
      await options.adapter.close();
      chunks = [];
      patch({ phase: "idle", elapsedMs: 0, level: 0 });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return snapshot.phase === "recording"
        ? { ...snapshot, elapsedMs: elapsed() }
        : snapshot;
    },
  };
}
