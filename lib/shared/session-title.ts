export const NO_MESSAGES_PLACEHOLDER = "(no messages)";

export function cleanFirstMessage(text: string | null | undefined): string {
  const trimmed = text?.trim();
  if (!trimmed || trimmed === NO_MESSAGES_PLACEHOLDER) return "";
  return trimmed;
}

export interface SessionTitleSource {
  id: string;
  name?: string | null;
  firstMessage?: string | null;
}

export function sessionDisplayTitle(session: SessionTitleSource, maxLength = 50): string {
  const name = session.name?.trim();
  if (name) return name;
  const firstMessage = cleanFirstMessage(session.firstMessage);
  if (firstMessage) return firstMessage.slice(0, maxLength);
  return session.id.slice(0, 12);
}
