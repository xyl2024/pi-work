import { describe, expect, it } from "vitest";
import {
  createVoiceRecorder,
  type VoiceRecorderAdapter,
  type VoiceRecorderAdapterHandlers,
} from "@/lib/client/voice-recorder";
import { VOICE_INPUT_SAMPLE_RATE } from "@/lib/shared/voice-input";

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
      handlers = null;
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
