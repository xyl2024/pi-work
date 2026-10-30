"use client";

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
  sessionId: string | null;
  isStreaming: boolean;
  agentRunning: boolean;
  messages: readonly AgentMessage[];
}

export interface UseReplayResult {
  visible: boolean;
  buttonVisible: boolean;
  cropIndex: number | null;
  index: number;
  playing: boolean;
  speed: number;
  positionLabel: string;
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

  useEffect(() => {
    dispatch({ type: "sessionChanged" });
  }, [sessionId]);

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
