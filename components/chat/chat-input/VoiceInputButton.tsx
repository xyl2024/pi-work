"use client";

import { useI18n } from "@/hooks/useI18n";
import { chatInputMetrics } from "./metrics";
import { VOICE_INPUT_MAX_DURATION_MS, type VoiceInputPhase } from "@/lib/shared/voice-input";

export interface VoiceInputButtonProps {
  phase: VoiceInputPhase;
  elapsedMs: number;
  level: number;
  onClick: () => void;
  disabled?: boolean;
}

const LABEL_KEYS: Record<VoiceInputPhase, string> = {
  idle: "Start voice input",
  recording: "Finish voice input",
  transcribing: "Transcribing...",
};

const TITLE_KEYS: Record<VoiceInputPhase, string> = {
  idle: "Start voice input (⌘⇧M / Ctrl+Shift+M)",
  recording: "Finish voice input (⌘⇧M / Ctrl+Shift+M)",
  transcribing: "Transcribing...",
};

function MicIcon() {
  return (
    <svg width={chatInputMetrics.sendIcon} height={chatInputMetrics.sendIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width={chatInputMetrics.sendIcon} height={chatInputMetrics.sendIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

export function VoiceInputButton({ phase, elapsedMs, level, onClick, disabled = false }: VoiceInputButtonProps) {
  const { t } = useI18n();
  const label = t(LABEL_KEYS[phase]);
  const title = t(TITLE_KEYS[phase]);
  const active = phase === "recording";
  const progress = Math.min(1, elapsedMs / VOICE_INPUT_MAX_DURATION_MS);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || phase === "transcribing"}
      aria-label={label}
      aria-keyshortcuts="Meta+Shift+M Control+Shift+M"
      title={title}
      style={{
        flexShrink: 0,
        alignSelf: "flex-end",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        width: chatInputMetrics.sendButton,
        height: chatInputMetrics.sendButton,
        padding: 0,
        background: active ? "rgba(239,68,68,0.12)" : "var(--bg-panel)",
        border: "none",
        borderRadius: "50%",
        color: active ? "#ef4444" : "var(--text-dim)",
        cursor: disabled || phase === "transcribing" ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        overflow: "hidden",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {phase === "idle" && <MicIcon />}
      {phase === "recording" && (
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#ef4444",
            transform: `scale(${1 + Math.min(level, 1) * 0.6})`,
            transition: "transform 0.08s",
          }}
        />
      )}
      {phase === "transcribing" && <SpinnerIcon />}
      {active && (
        <span
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 2,
            width: `${progress * 100}%`,
            background: "#ef4444",
          }}
        />
      )}
    </button>
  );
}
