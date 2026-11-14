import type { VoiceInputPhase } from "./voice-input";

export interface ChatShortcutFacts {
  foreground: boolean;
  tabActive: boolean;
  sessionId: string | null;
}

export interface VoiceInputShortcutFacts {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  menuOpen: boolean;
  phase: VoiceInputPhase;
  disabled: boolean;
  supported: boolean;
}

export function canToggleSessionSearch(facts: ChatShortcutFacts): boolean {
  return facts.foreground && facts.tabActive && facts.sessionId !== null;
}

export function canFocusChatInput(facts: Pick<ChatShortcutFacts, "foreground">): boolean {
  return facts.foreground;
}

export function matchesVoiceInputShortcut(
  facts: Pick<VoiceInputShortcutFacts, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean {
  return (
    facts.key.toLowerCase() === "m" &&
    (facts.metaKey || facts.ctrlKey) &&
    facts.shiftKey &&
    !facts.altKey
  );
}

export function canToggleVoiceInput(facts: VoiceInputShortcutFacts): boolean {
  return (
    matchesVoiceInputShortcut(facts) &&
    !facts.menuOpen &&
    facts.phase !== "transcribing" &&
    !facts.disabled &&
    facts.supported
  );
}
