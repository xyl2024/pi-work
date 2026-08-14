"use client";

import { useEffect, useState, type ReactNode } from "react";

interface Props {
  /** Header label rendered next to the chevron (uppercased, matching the
   *  sidebar's existing section headers). */
  title: ReactNode;
  /** Whether the content area is expanded. */
  open: boolean;
  /** Called when the header row (chevron/title) is clicked. */
  onToggle: () => void;
  /** Optional action buttons rendered at the right end of the header row
   *  (e.g. collapse-all, refresh). */
  actions?: ReactNode;
  /** Content rendered below the header, inside an internal scroll container. */
  children: ReactNode;
  /** Height-animation duration; default 180ms — same as CollapsiblePanel. */
  durationMs?: number;
}

// Collapsible section for the left sidebar. Explorer today, future sections
// with the same collapse/expand behavior should reuse this component.
//
// Unlike CollapsiblePanel / useCollapseHeight — which animate to the *content*
// height — a sidebar section expands to whatever free space the flex column
// grants it (siblings like MultiCwdList share the remaining height), so the
// animation is driven by `flex-grow` itself: transitioning 0↔1 makes the
// browser re-flow the section's height every frame toward the flex-computed
// target. No pixel measurement is needed and the target is always correct,
// even when a sibling section's own open state changes the free space.
//
// The trick that keeps this smooth without measuring: flex-basis stays `auto`
// while the content wrapper has `flex-basis: 0`. The section's content height
// is therefore always exactly the header row — closed state is just the
// header, open state is header + grow × free space, and the closed header can
// never be compressed (flexShrink: 0 when closed, matching the previous
// `flex: 0 0 auto` behavior).
export function SidebarSection({ title, open, onToggle, actions, children, durationMs = 180 }: Props) {
  // Keep the content mounted through the collapse animation (it must be in
  // the DOM to squeeze to zero), then unmount it after the transition
  // settles — same lifecycle as MultiCwdList's body. Unmounting releases
  // things like FileExplorer's git polling while the section is collapsed.
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), durationMs + 40);
    return () => window.clearTimeout(timer);
  }, [open, durationMs]);

  const ease = "cubic-bezier(0.32, 0.72, 0, 1)";

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexGrow: open ? 1 : 0,
        flexShrink: open ? 1 : 0,
        flexBasis: "auto",
        minHeight: 0,
        overflow: "hidden",
        transition: `flex-grow ${durationMs}ms ${ease}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={onToggle}
          aria-expanded={open}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            padding: "6px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            textAlign: "left",
          }}
        >
          <svg
            width="9" height="9" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{
              flexShrink: 0,
              transform: open ? "rotate(90deg)" : "none",
              transition: `transform ${durationMs}ms ${ease}`,
            }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
          {title}
        </button>
        {actions && (
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {mounted && (
        <div style={{ flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
          <div data-hover-scrollbar style={{ height: "100%", overflowY: "auto", overflowX: "hidden" }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
