"use client";

/** Disclosure chevron for the plan list's collapsible groups (overdue, 待整理).
 *  Shared so the two groups rotate identically instead of drifting apart. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.12s",
      }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
