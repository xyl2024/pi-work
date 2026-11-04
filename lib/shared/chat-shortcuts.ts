export interface ChatShortcutFacts {
  foreground: boolean;
  tabActive: boolean;
  sessionId: string | null;
}

export function canToggleSessionSearch(facts: ChatShortcutFacts): boolean {
  return facts.foreground && facts.tabActive && facts.sessionId !== null;
}

export function canFocusChatInput(facts: Pick<ChatShortcutFacts, "foreground">): boolean {
  return facts.foreground;
}
