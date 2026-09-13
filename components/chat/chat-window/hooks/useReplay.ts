"use client";

/**
 * Replay wiring for one chat window.
 *
 * The rules — when replay is available, when a live session force-closes it,
 * where an open scrubber starts, which cutoff the chat crops to and what the
 * position label reads — live in `lib/shared/replay.ts` as a reducer plus
 * derived selectors. This hook owns only the React state and forwards events;
 * the session signals and the message list come in as parameters, and the hook
 * contains no branch of its own.
 *
 * `ReplayBar`'s interface is deliberately unchanged: it reports scrubbing,
 * playback and speed, and this hook decides what that means. The shell's
 * Replay entry stays wired through `ChatHeaderActions` (one snapshot shared
 * with export / auto-name / compact), so the hook exposes the two fields that
 * snapshot needs (`buttonVisible`, `open`) instead of publishing it itself.
 */

import { useCallback, useEffect, useReducer } from "react";
import {
  INITIAL_REPLAY_STATE,
  isReplayButtonVisible,
  replayCropIndex,
  replayPositionLabel,
  replayReducer,
} from "@/lib/shared/replay";
import type { AgentMessage } from "@/lib/shared/types";

export interface UseReplayOptions {
  /** Selected session id; a switch closes the scrubber. */
  sessionId: string | null;
  /** The agent is streaming a reply — replay must not fight the live tail. */
  isStreaming: boolean;
  /** A turn is in progress — same reason. */
  agentRunning: boolean;
  /** The session's messages: the scrubber's total and the cutoff timestamp. */
  messages: readonly AgentMessage[];
}

export interface UseReplayResult {
  /** Open scrubber on a settled session — `ReplayBar` is on screen. */
  visible: boolean;
  /** The shell's Replay entry may be shown (settled session with messages). */
  buttonVisible: boolean;
  /** Cutoff for `ChatTimeline.sliceForReplay`; null renders everything. */
  cropIndex: number | null;
  /** `ReplayBar` props, passed straight through. */
  index: number;
  playing: boolean;
  speed: number;
  positionLabel: string;
  /** Open the scrubber at the end of the conversation (the shell entry). */
  open: () => void;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (speed: number) => void;
}

export function useReplay({
  sessionId,
  isStreaming,
  agentRunning,
  messages,
}: UseReplayOptions): UseReplayResult {
  const [state, dispatch] = useReducer(replayReducer, INITIAL_REPLAY_STATE);

  // A session switch starts replay over. (In-session search resets inside
  // useSessionSearch, which owns that state.)
  useEffect(() => {
    dispatch({ type: "sessionChanged" });
  }, [sessionId]);

  // Replay and a live stream must not coexist — the truncated view would fight
  // the SSE tail. The reducer ignores this event while the session is settled.
  useEffect(() => {
    dispatch({ type: "liveStateChanged", signals: { isStreaming, agentRunning } });
  }, [isStreaming, agentRunning]);

  const open = useCallback(() => {
    dispatch({ type: "opened", total: messages.length });
  }, [messages.length]);
  const onClose = useCallback(() => {
    dispatch({ type: "closed" });
  }, []);
  const onIndexChange = useCallback((index: number) => {
    dispatch({ type: "indexChanged", index });
  }, []);
  const onPlayingChange = useCallback((playing: boolean) => {
    dispatch({ type: "playingChanged", playing });
  }, []);
  const onSpeedChange = useCallback((speed: number) => {
    dispatch({ type: "speedChanged", speed });
  }, []);

  const signals = { isStreaming, agentRunning };
  const cropIndex = replayCropIndex(state, signals);

  return {
    visible: cropIndex !== null,
    buttonVisible: isReplayButtonVisible(signals, messages.length),
    cropIndex,
    index: state.index,
    playing: state.playing,
    speed: state.speed,
    positionLabel: replayPositionLabel(state.index, messages),
    open,
    onClose,
    onIndexChange,
    onPlayingChange,
    onSpeedChange,
  };
}
