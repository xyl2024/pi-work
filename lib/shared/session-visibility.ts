export interface SessionVisibility {
  id: string;
  assistant?: boolean;
}

export function isUserVisibleSession(
  session: SessionVisibility,
  subagentIds: ReadonlySet<string>,
): boolean {
  return !subagentIds.has(session.id) && session.assistant !== true;
}
