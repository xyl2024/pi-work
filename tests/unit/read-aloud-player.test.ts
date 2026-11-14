import { describe, expect, it, vi } from "vitest";
import { createReadAloudPlayer, type ReadAloudAudio } from "@/lib/client/read-aloud-player";
import type { ReadAloudSynthesisResult } from "@/lib/client/read-aloud-io";

interface FakeAudio extends ReadAloudAudio {
  playMock: ReturnType<typeof vi.fn>;
  pauseMock: ReturnType<typeof vi.fn>;
  emitEnded(): void;
  emitError(): void;
}

function createHarness() {
  const audios: FakeAudio[] = [];
  const revoked: string[] = [];
  let urlId = 0;

  const createAudio = (src: string): FakeAudio => {
    const playMock = vi.fn(async () => {});
    const pauseMock = vi.fn();
    const audio: FakeAudio = {
      src,
      currentTime: 0,
      onended: null,
      onerror: null,
      playMock,
      pauseMock,
      play: () => playMock() as Promise<void>,
      pause: () => {
        pauseMock();
      },
      emitEnded() {
        audio.onended?.();
      },
      emitError() {
        audio.onerror?.();
      },
    };
    audios.push(audio);
    return audio;
  };

  return {
    audios,
    revoked,
    createAudio,
    createObjectUrl: () => {
      urlId += 1;
      return `blob:read-aloud-${urlId}`;
    },
    revokeObjectUrl: (url: string) => {
      revoked.push(url);
    },
  };
}

function okAudio(): ReadAloudSynthesisResult {
  return { ok: true, audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createReadAloudPlayer", () => {
  it("synthesizes on the first toggle and starts playing the returned audio", async () => {
    const harness = createHarness();
    const synthesize = vi.fn(async () => okAudio());
    const player = createReadAloudPlayer({ ...harness, synthesize });

    player.toggle("m1", "hello");

    expect(player.getSnapshot()).toMatchObject({ phase: "synthesizing", key: "m1" });
    await flush();

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledWith("hello", expect.any(AbortSignal));
    expect(player.getSnapshot()).toMatchObject({ phase: "playing", key: "m1" });
    expect(harness.audios).toHaveLength(1);
    expect(harness.audios[0].src).toBe("blob:read-aloud-1");
    expect(harness.audios[0].playMock).toHaveBeenCalledTimes(1);
  });

  it("pauses and resumes from the same position", async () => {
    const harness = createHarness();
    const player = createReadAloudPlayer({ ...harness, synthesize: async () => okAudio() });

    player.toggle("m1", "hello");
    await flush();
    const audio = harness.audios[0];
    audio.currentTime = 4.5;

    player.toggle("m1", "hello");
    expect(player.getSnapshot().phase).toBe("paused");
    expect(audio.pauseMock).toHaveBeenCalledTimes(1);

    player.toggle("m1", "hello");
    expect(player.getSnapshot().phase).toBe("playing");
    expect(audio.playMock).toHaveBeenCalledTimes(2);
    expect(audio.currentTime).toBe(4.5);
  });

  it("returns to idle and releases the blob url when playback ends", async () => {
    const harness = createHarness();
    const player = createReadAloudPlayer({ ...harness, synthesize: async () => okAudio() });

    player.toggle("m1", "hello");
    await flush();
    harness.audios[0].emitEnded();

    expect(player.getSnapshot()).toMatchObject({ phase: "idle", key: null, error: null });
    expect(harness.revoked).toEqual(["blob:read-aloud-1"]);
  });

  it("interrupts the previous message when another one is toggled", async () => {
    const harness = createHarness();
    const synthesize = vi.fn(async () => okAudio());
    const player = createReadAloudPlayer({ ...harness, synthesize });

    player.toggle("m1", "first");
    await flush();
    player.toggle("m2", "second");
    await flush();

    expect(harness.audios).toHaveLength(2);
    expect(harness.audios[0].pauseMock).toHaveBeenCalledTimes(1);
    expect(harness.revoked).toEqual(["blob:read-aloud-1"]);
    expect(player.getSnapshot()).toMatchObject({ phase: "playing", key: "m2" });
    expect(harness.audios[1].pauseMock).not.toHaveBeenCalled();
  });

  it("ignores repeated toggles while the same message is synthesizing", async () => {
    const harness = createHarness();
    const pending = deferred<ReadAloudSynthesisResult>();
    const synthesize = vi.fn(() => pending.promise);
    const player = createReadAloudPlayer({ ...harness, synthesize });

    player.toggle("m1", "hello");
    player.toggle("m1", "hello");
    player.toggle("m1", "hello");

    expect(synthesize).toHaveBeenCalledTimes(1);
    pending.resolve(okAudio());
    await flush();
    expect(player.getSnapshot().phase).toBe("playing");
  });

  it("reports a failure and returns to a clickable idle state", async () => {
    const harness = createHarness();
    const player = createReadAloudPlayer({
      ...harness,
      synthesize: async () => ({ ok: false, code: "blocked" }),
    });

    player.toggle("m1", "hello");
    await flush();

    expect(harness.audios).toHaveLength(0);
    expect(player.getSnapshot()).toMatchObject({
      phase: "idle",
      key: null,
      error: "blocked",
      errorKey: "m1",
      errorId: 1,
    });
  });

  it("retries a busy failure once and plays the retried audio", async () => {
    const harness = createHarness();
    const synthesize = vi
      .fn<() => Promise<ReadAloudSynthesisResult>>()
      .mockResolvedValueOnce({ ok: false, code: "busy" })
      .mockResolvedValueOnce(okAudio());
    const waitForRetry = vi.fn(async () => true);
    const player = createReadAloudPlayer({ ...harness, synthesize, waitForRetry });

    player.toggle("m1", "hello");
    await flush();
    await flush();

    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(player.getSnapshot()).toMatchObject({ phase: "playing", key: "m1", error: null });
  });

  it("retries timeouts and network errors too", async () => {
    for (const code of ["timeout", "network"] as const) {
      const harness = createHarness();
      const synthesize = vi
        .fn<() => Promise<ReadAloudSynthesisResult>>()
        .mockResolvedValueOnce({ ok: false, code })
        .mockResolvedValueOnce(okAudio());
      const player = createReadAloudPlayer({
        ...harness,
        synthesize,
        waitForRetry: async () => true,
      });

      player.toggle("m1", "hello");
      await flush();
      await flush();

      expect(synthesize).toHaveBeenCalledTimes(2);
      expect(player.getSnapshot().phase).toBe("playing");
    }
  });

  it("does not retry failures that a retry cannot fix", async () => {
    for (const code of ["missing_key", "too_long", "blocked", "rate_limited", "failed"] as const) {
      const synthesize = vi.fn(async () => ({ ok: false, code }) as ReadAloudSynthesisResult);
      const waitForRetry = vi.fn(async () => true);
      const player = createReadAloudPlayer({ ...createHarness(), synthesize, waitForRetry });

      player.toggle("m1", "hello");
      await flush();

      expect(synthesize).toHaveBeenCalledTimes(1);
      expect(waitForRetry).not.toHaveBeenCalled();
      expect(player.getSnapshot()).toMatchObject({ phase: "idle", error: code });
    }
  });

  it("reports the failure after the single retry also fails", async () => {
    const synthesize = vi.fn(async () => ({ ok: false, code: "busy" }) as ReadAloudSynthesisResult);
    const player = createReadAloudPlayer({
      ...createHarness(),
      synthesize,
      waitForRetry: async () => true,
    });

    player.toggle("m1", "hello");
    await flush();
    await flush();

    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(player.getSnapshot()).toMatchObject({
      phase: "idle",
      key: null,
      error: "busy",
      errorKey: "m1",
    });
  });

  it("maps a thrown synthesis to a network failure", async () => {
    const synthesize = vi.fn(async () => {
      throw new Error("offline");
    });
    const player = createReadAloudPlayer({
      ...createHarness(),
      synthesize,
      waitForRetry: async () => true,
    });

    player.toggle("m1", "hello");
    await flush();
    await flush();

    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(player.getSnapshot()).toMatchObject({ phase: "idle", error: "network" });
  });

  it("drops the retry when playback is stopped during the wait", async () => {
    const synthesize = vi.fn(async () => ({ ok: false, code: "busy" }) as ReadAloudSynthesisResult);
    const player = createReadAloudPlayer({
      ...createHarness(),
      synthesize,
      waitForRetry: async (signal) => {
        player.stop();
        return !signal.aborted;
      },
    });

    player.toggle("m1", "hello");
    await flush();
    await flush();

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(player.getSnapshot()).toMatchObject({ phase: "idle", key: null, error: null });
  });

  it("aborts the in-flight synthesis when stopped", async () => {
    const harness = createHarness();
    const pending = deferred<ReadAloudSynthesisResult>();
    const captured: { signal: AbortSignal | null } = { signal: null };
    const player = createReadAloudPlayer({
      ...harness,
      synthesize: (_text, nextSignal) => {
        captured.signal = nextSignal;
        return pending.promise;
      },
    });

    player.toggle("m1", "hello");
    player.stop();

    expect(captured.signal?.aborted).toBe(true);
    expect(player.getSnapshot()).toMatchObject({ phase: "idle", key: null });

    pending.resolve(okAudio());
    await flush();

    expect(harness.audios).toHaveLength(0);
    expect(player.getSnapshot()).toMatchObject({ phase: "idle", key: null, error: null });
  });

  it("stops playback and releases the blob url when stopped", async () => {
    const harness = createHarness();
    const player = createReadAloudPlayer({ ...harness, synthesize: async () => okAudio() });

    player.toggle("m1", "hello");
    await flush();
    player.stop();

    expect(harness.audios[0].pauseMock).toHaveBeenCalledTimes(1);
    expect(harness.revoked).toEqual(["blob:read-aloud-1"]);
    expect(player.getSnapshot()).toMatchObject({ phase: "idle", key: null });
  });
});
