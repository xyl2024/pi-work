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

const IDLE: VoiceRecorderSnapshot = { phase: "idle", elapsedMs: 0, level: 0 };

export function createVoiceRecorder(options: VoiceRecorderOptions): VoiceRecorder {
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  let snapshot: VoiceRecorderSnapshot = IDLE;
  let chunks: Int16Array[] = [];
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let acceptingSamples = false;
  let releasePromise: Promise<void> | null = null;
  let startToken = 0;

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

  function release(): Promise<void> {
    if (!releasePromise) {
      releasePromise = options.adapter.close().finally(() => {
        releasePromise = null;
      });
    }
    return releasePromise;
  }

  function takeChunks(): Int16Array[] {
    acceptingSamples = false;
    const taken = chunks;
    chunks = [];
    return taken;
  }

  async function stop(): Promise<VoiceRecorderResult | null> {
    if (snapshot.phase !== "recording") return null;
    clearTimer();
    const durationMs = elapsed();
    const taken = takeChunks();
    patch(IDLE);
    await release();
    return { wav: encodePcm16Wav(taken, VOICE_INPUT_SAMPLE_RATE), durationMs };
  }

  return {
    async start() {
      if (snapshot.phase !== "idle") return;
      if (releasePromise) await releasePromise;
      if (snapshot.phase !== "idle") return;

      const token = (startToken += 1);
      try {
        await options.adapter.open({
          onSamples(samples) {
            if (!acceptingSamples) return;
            chunks.push(samples);
          },
          onLevel(level) {
            if (!acceptingSamples) return;
            patch({ ...snapshot, level });
          },
        });
      } catch (error) {
        if (token !== startToken) return;
        throw error;
      }

      if (token !== startToken) {
        await release();
        return;
      }

      chunks = [];
      acceptingSamples = true;
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
      startToken += 1;
      if (snapshot.phase !== "recording") return;
      clearTimer();
      takeChunks();
      patch(IDLE);
      await release();
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
