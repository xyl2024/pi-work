/**
 * Which "somebody needs you" dot a sidebar session row shows.
 *
 * Two client sources can mark a session: the pending `ask_user_questions`
 * card (module store, keyed by sessionId) and the pending dangerous-command
 * confirmation (the permission queue in `hooks/usePendingPermissions`). A row
 * has room for one dot, so the merge — and the precedence rule — lives here,
 * as a pure function both the sidebar and the unit tests can call.
 *
 * Permission wins over question: a gate blocks a command from *executing*,
 * while a question only blocks the model's next step. When both are open the
 * user is better served by the row pointing at the command.
 */

/** The one attention state a row can display. */
export type SessionAttention = "question" | "permission";

/**
 * Merge the two per-session sources into one map. Later (higher-precedence)
 * sources overwrite earlier ones, so a session listed in both ends up with
 * "permission"; duplicate ids collapse into a single entry.
 */
export function sessionAttentionById(
  questionSessionIds: Iterable<string>,
  permissionSessionIds: Iterable<string>,
): Map<string, SessionAttention> {
  const attention = new Map<string, SessionAttention>();
  for (const sessionId of questionSessionIds) attention.set(sessionId, "question");
  for (const sessionId of permissionSessionIds) attention.set(sessionId, "permission");
  return attention;
}
