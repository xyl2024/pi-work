import { describe, expect, it } from "vitest";
import {
  INITIAL_REPLAY_STATE,
  isReplayAvailable,
  isReplayButtonVisible,
  replayCropIndex,
  replayPositionLabel,
  replayReducer,
  type ReplayState,
} from "@/lib/shared/replay";

const settled = { isStreaming: false, agentRunning: false };
const streaming = { isStreaming: true, agentRunning: false };
const running = { isStreaming: false, agentRunning: true };

function state(overrides: Partial<ReplayState> = {}): ReplayState {
  return { ...INITIAL_REPLAY_STATE, ...overrides };
}

describe("isReplayAvailable", () => {
  it("is available only while the session is settled", () => {
    expect(isReplayAvailable(settled)).toBe(true);
  });

  it("is unavailable while streaming or running", () => {
    expect(isReplayAvailable(streaming)).toBe(false);
    expect(isReplayAvailable(running)).toBe(false);
    expect(isReplayAvailable({ isStreaming: true, agentRunning: true })).toBe(false);
  });
});

describe("isReplayButtonVisible", () => {
  it("needs a settled session and at least one message", () => {
    expect(isReplayButtonVisible(settled, 3)).toBe(true);
  });

  it("hides an empty conversation", () => {
    expect(isReplayButtonVisible(settled, 0)).toBe(false);
  });

  it("hides a live session even when it has messages", () => {
    expect(isReplayButtonVisible(streaming, 3)).toBe(false);
    expect(isReplayButtonVisible(running, 3)).toBe(false);
  });
});

describe("replayReducer", () => {
  it("starts closed at the beginning with normal speed", () => {
    expect(INITIAL_REPLAY_STATE).toEqual({ open: false, index: 0, playing: false, speed: 1 });
  });

  it("opens at the end of the conversation and pauses playback", () => {
    const opened = replayReducer(state({ playing: true }), { type: "opened", total: 12 });
    expect(opened).toEqual({ open: true, index: 12, playing: false, speed: 1 });
  });

  it("closes without losing the cutoff or the speed", () => {
    const closed = replayReducer(state({ open: true, index: 7, playing: true, speed: 2 }), {
      type: "closed",
    });
    expect(closed).toEqual({ open: false, index: 7, playing: false, speed: 2 });
  });

  it("passes the scrubber values straight through", () => {
    const base = state({ open: true, index: 3 });
    expect(replayReducer(base, { type: "indexChanged", index: 8 }).index).toBe(8);
    expect(replayReducer(base, { type: "playingChanged", playing: true }).playing).toBe(true);
    expect(replayReducer(base, { type: "speedChanged", speed: 1.5 }).speed).toBe(1.5);
  });

  it("closes on a session switch", () => {
    const switched = replayReducer(state({ open: true, index: 5, playing: true }), {
      type: "sessionChanged",
    });
    expect(switched).toEqual({ open: false, index: 5, playing: false, speed: 1 });
  });

  it("keeps state identity when a session switch changes nothing", () => {
    const closed = state();
    expect(replayReducer(closed, { type: "sessionChanged" })).toBe(closed);
    expect(replayReducer(closed, { type: "closed" })).toBe(closed);
  });

  it("force-closes once the agent starts running or streaming", () => {
    const open = state({ open: true, index: 9, playing: true });
    expect(replayReducer(open, { type: "liveStateChanged", signals: streaming })).toEqual({
      open: false,
      index: 9,
      playing: false,
      speed: 1,
    });
    expect(replayReducer(open, { type: "liveStateChanged", signals: running }).open).toBe(false);
  });

  it("leaves a settled session untouched", () => {
    const open = state({ open: true, index: 9, playing: true });
    expect(replayReducer(open, { type: "liveStateChanged", signals: settled })).toBe(open);
    // A live signal on an already closed scrubber is a no-op too, so the
    // effect that dispatches it every render never churns state.
    const closed = state();
    expect(replayReducer(closed, { type: "liveStateChanged", signals: streaming })).toBe(closed);
  });
});

describe("replayCropIndex", () => {
  it("renders the whole conversation while replay is closed", () => {
    expect(replayCropIndex(state({ open: false, index: 4 }), settled)).toBeNull();
  });

  it("crops to the cutoff once the scrubber is open on a settled session", () => {
    expect(replayCropIndex(state({ open: true, index: 4 }), settled)).toBe(4);
    // Index 0 means "render nothing" and must not collapse into "no replay".
    expect(replayCropIndex(state({ open: true, index: 0 }), settled)).toBe(0);
  });

  it("stops cropping when the session goes live underneath an open scrubber", () => {
    const open = state({ open: true, index: 4 });
    expect(replayCropIndex(open, streaming)).toBeNull();
    expect(replayCropIndex(open, running)).toBeNull();
  });

  it("passes an out-of-range cutoff through (the timeline clamps it)", () => {
    expect(replayCropIndex(state({ open: true, index: 99 }), settled)).toBe(99);
  });
});

describe("replayPositionLabel", () => {
  const messages = [{ timestamp: 1_700_000_000_000 }, {}, { timestamp: 1_700_000_060_000 }];

  it("shows current / total", () => {
    expect(replayPositionLabel(0, messages)).toBe("0 / 3");
    expect(replayPositionLabel(7, messages)).toBe("7 / 3");
  });

  it("appends the cutoff message's time when it has one", () => {
    expect(replayPositionLabel(1, messages)).toBe(
      `1 / 3 · ${new Date(1_700_000_000_000).toLocaleTimeString()}`,
    );
    expect(replayPositionLabel(3, messages)).toBe(
      `3 / 3 · ${new Date(1_700_000_060_000).toLocaleTimeString()}`,
    );
  });

  it("omits the time when the cutoff message has none", () => {
    expect(replayPositionLabel(2, messages)).toBe("2 / 3");
    expect(replayPositionLabel(3, [{}, {}, {}])).toBe("3 / 3");
  });
});
