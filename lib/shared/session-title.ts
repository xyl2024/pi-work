// ============================================================================
// Session display title (pure)
//
// A session row is titled with three fallbacks, in this order:
//   1. the session name (user rename / auto-naming),
//   2. the first user message, truncated,
//   3. a short stub of the session id.
//
// Step 2 is the "unnamed session" title. It must never be a placeholder: pi's
// listing writes the literal "(no messages)" into `firstMessage` when a session
// has no message text (image-only first turn, aborted session, header-only
// file), and a session that was never named — including one whose auto-name
// call came back empty — has to keep looking like any other unnamed session
// instead of displaying that string as if it were the first message.
//
// The server normalizes the field at the reader (`lib/server/sessions/reader.ts`
// uses `cleanFirstMessage`), and the title rule cleans it again so cached rows
// from an older snapshot cannot leak the placeholder either.
// ============================================================================

/** pi's `firstMessage` value when a session holds no message text. */
export const NO_MESSAGES_PLACEHOLDER = "(no messages)";

/** `""` when the text is missing/blank or pi's "(no messages)" placeholder. */
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

/**
 * Title for one session row / tab / browser tab. `maxLength` bounds the
 * first-message fallback (sidebar uses 50, favorites 60) — names are never
 * truncated here, the API caps them at 120.
 */
export function sessionDisplayTitle(session: SessionTitleSource, maxLength = 50): string {
  const name = session.name?.trim();
  if (name) return name;
  const firstMessage = cleanFirstMessage(session.firstMessage);
  if (firstMessage) return firstMessage.slice(0, maxLength);
  return session.id.slice(0, 12);
}
