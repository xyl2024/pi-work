import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceRecorder,
  type VoiceRecorderAdapter,
  type VoiceRecorderAdapterHandlers,
} from "@/lib/client/voice-recorder";
import { VOICE_INPUT_MAX_DURATION_MS, VOICE_INPUT_SAMPLE_RATE } from "@/lib/shared/voice-input";

function createFakeAdapter() {
  let handlers: VoiceRecorderAdapterHandlers | null = null;
  let opened = 0;
  let closed = 0;
  const adapter: VoiceRecorderAdapter = {
    async open(next) {
      handlers = next;
      opened += 1;
    },
    async close() {
      closed += 1;
    },
  };
  return {
    adapter,
    emit(samples: number[]) {
      handlers?.onSamples(Int16Array.from(samples));
    },
    emitLevel(level: number) {
      handlers?.onLevel(level);
    },
    get opened() {
      return opened;
    },
    get closed() {
      return closed;
    },
  };
}

function pcmValues(wav: Uint8Array): number[] {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const byteLength = view.getUint32(40, true);
  return Array.from({ length: byteLength / 2 }, (_, i) => view.getInt16(44 + i * 2, true));
}

describe("createVoiceRecorder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an encoded wav and the wall-clock duration when stopped", async () => {
    const fake = createFakeAdapter();
    let clock = 1_000;
    const recorder = createVoiceRecorder({ adapter: fake.adapter, now: () => clock });

    await recorder.start();
    expect(recorder.getSnapshot().phase).toBe("recording");

    fake.emit([10, -20]);
    clock = 2_500;
    fake.emit([30]);
    const result = await recorder.stop();

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.durationMs).toBe(1_500);
    expect(result.wav.byteLength).toBe(44 + 6);
    expect(pcmValues(result.wav)).toEqual([10, -20, 30]);
    expect(new DataView(result.wav.buffer).getUint32(24, true)).toBe(VOICE_INPUT_SAMPLE_RATE);
    expect(recorder.getSnapshot().phase).toBe("idle");
    expect(fake.opened).toBe(1);
    expect(fake.closed).toBe(1);
  });

  it("keeps the latest level and elapsed time in the snapshot", async () => {
    const fake = createFakeAdapter();
    let clock = 5_000;
    const recorder = createVoiceRecorder({ adapter: fake.adapter, now: () => clock });

    await recorder.start();
    fake.emitLevel(0.42);
    fake.emit([1]);
    clock = 5_750;

    const snapshot = recorder.getSnapshot();
    expect(snapshot.phase).toBe("recording");
    expect(snapshot.level).toBe(0.42);
    expect(snapshot.elapsedMs).toBe(750);

    await recorder.cancel();
  });

  it("releases the adapter and ignores late samples after cancel", async () => {
    const fake = createFakeAdapter();
    const recorder = createVoiceRecorder({ adapter: fake.adapter, now: () => 0 });

    await recorder.start();
    fake.emit([7]);
    await recorder.cancel();

    expect(fake.closed).toBe(1);
    expect(recorder.getSnapshot().phase).toBe("idle");
    fake.emit([8]);
    expect(await recorder.stop()).toBeNull();
  });

  it("never mixes samples that arrive after cancel into a later recording", async () => {
    const fake = createFakeAdapter();
    const recorder = createVoiceRecorder({ adapter: fake.adapter, now: () => 0 });

    await recorder.start();
    fake.emit([7]);
    await recorder.cancel();
    fake.emit([8]);
    await recorder.start();
    fake.emit([9]);
    const result = await recorder.stop();

    expect(result).not.toBeNull();
    expect(pcmValues(result!.wav)).toEqual([9]);
    expect(fake.opened).toBe(2);
    expect(fake.closed).toBe(2);
  });

  it("stays idle when the adapter refuses to open", async () => {
    const denial = new DOMException("denied", "NotAllowedError");
    const adapter: VoiceRecorderAdapter = {
      async open() {
        throw denial;
      },
      async close() {},
    };
    const recorder = createVoiceRecorder({ adapter, now: () => 0 });

    await expect(recorder.start()).rejects.toBe(denial);

    expect(recorder.getSnapshot()).toEqual({ phase: "idle", elapsedMs: 0, level: 0 });
    expect(await recorder.stop()).toBeNull();
  });

  it("excludes samples that arrive while stop is releasing the adapter", async () => {
    const state: {
      handlers: VoiceRecorderAdapterHandlers | null;
      releaseClose: (() => void) | null;
    } = { handlers: null, releaseClose: null };
    const adapter: VoiceRecorderAdapter = {
      async open(next) {
        state.handlers = next;
      },
      close() {
        return new Promise<void>((resolve) => {
          state.releaseClose = resolve;
        });
      },
    };
    const recorder = createVoiceRecorder({ adapter, now: () => 0 });

    await recorder.start();
    state.handlers?.onSamples(Int16Array.from([1]));
    const stopping = recorder.stop();
    state.handlers?.onSamples(Int16Array.from([2]));
    state.releaseClose?.();
    const result = await stopping;

    expect(result).not.toBeNull();
    expect(pcmValues(result!.wav)).toEqual([1]);
  });

  it("releases the adapter once across repeated and concurrent cancels", async () => {
    const fake = createFakeAdapter();
    const recorder = createVoiceRecorder({ adapter: fake.adapter, now: () => 0 });

    await recorder.start();
    await Promise.all([recorder.cancel(), recorder.cancel()]);
    await recorder.cancel();

    expect(fake.closed).toBe(1);
    expect(recorder.getSnapshot()).toEqual({ phase: "idle", elapsedMs: 0, level: 0 });
  });

  it("releases the adapter when cancelled while opening", async () => {
    let releaseOpen: (() => void) | undefined;
    let closed = 0;
    const adapter: VoiceRecorderAdapter = {
      open() {
        return new Promise<void>((resolve) => {
          releaseOpen = resolve;
        });
      },
      async close() {
        closed += 1;
      },
    };
    const recorder = createVoiceRecorder({ adapter, now: () => 0 });

    const starting = recorder.start();
    await recorder.cancel();
    releaseOpen?.();
    await starting;

    expect(closed).toBe(1);
    expect(recorder.getSnapshot().phase).toBe("idle");
    expect(await recorder.stop()).toBeNull();
  });

  it("auto-stops at the recording cap and hands over the audio once", async () => {
    vi.useFakeTimers();
    const fake = createFakeAdapter();
    let clock = 0;
    const autoStopped: { durationMs: number; wav: Uint8Array }[] = [];
    const recorder = createVoiceRecorder({
      adapter: fake.adapter,
      now: () => clock,
      onAutoStop: (result) => autoStopped.push(result),
    });

    await recorder.start();
    fake.emit([4, 5]);
    clock = VOICE_INPUT_MAX_DURATION_MS;
    await vi.advanceTimersByTimeAsync(100);

    expect(autoStopped).toHaveLength(1);
    expect(autoStopped[0].durationMs).toBe(VOICE_INPUT_MAX_DURATION_MS);
    expect(pcmValues(autoStopped[0].wav)).toEqual([4, 5]);
    expect(recorder.getSnapshot()).toEqual({ phase: "idle", elapsedMs: 0, level: 0 });
    expect(fake.closed).toBe(1);
    expect(await recorder.stop()).toBeNull();
  });

  it("notifies listeners on phase changes", async () => {
    const fake = createFakeAdapter();
    const recorder = createVoiceRecorder({ adapter: fake.adapter, now: () => 0 });
    const phases: string[] = [];
    const unsubscribe = recorder.subscribe(() => phases.push(recorder.getSnapshot().phase));

    await recorder.start();
    await recorder.stop();
    unsubscribe();
    await recorder.start();
    await recorder.cancel();

    expect(phases).toEqual(["recording", "idle"]);
  });
});
