export type SessionAttention = "question" | "permission";

export function sessionAttentionById(
  questionSessionIds: Iterable<string>,
  permissionSessionIds: Iterable<string>,
): Map<string, SessionAttention> {
  const attention = new Map<string, SessionAttention>();
  for (const sessionId of questionSessionIds) attention.set(sessionId, "question");
  for (const sessionId of permissionSessionIds) attention.set(sessionId, "permission");
  return attention;
}
