"use client";

import type { GitFileStatus } from "@/lib/shared/git-diff-types";

const BADGE_LETTER: Record<GitFileStatus, string> = {
  A: "A",
  M: "M",
  D: "D",
  R: "R",
  C: "C",
  T: "T",
  U: "!",
  "??": "U",
};

const BADGE_BG: Record<GitFileStatus, string> = {
  A: "var(--git-status-added)",
  M: "var(--git-status-modified)",
  D: "var(--git-status-deleted)",
  R: "var(--git-status-renamed)",
  C: "var(--git-status-renamed)",
  T: "var(--git-status-renamed)",
  U: "var(--git-status-conflict)",
  "??": "var(--git-status-untracked)",
};

export function gitStatusColor(status: GitFileStatus): string {
  return BADGE_BG[status];
}

interface Props {
  status: GitFileStatus;
}

export function FileGitBadge({ status }: Props) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 12,
        marginLeft: 4,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: "var(--font-mono), monospace",
        color: BADGE_BG[status],
        textAlign: "center",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {BADGE_LETTER[status]}
    </span>
  );
}