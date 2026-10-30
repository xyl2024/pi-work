"use client";

const autoNamedSessionIds = new Set<string>();

export function claimAutoNamedSession(sessionId: string): boolean {
  if (autoNamedSessionIds.has(sessionId)) return false;
  autoNamedSessionIds.add(sessionId);
  return true;
}
