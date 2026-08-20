"use client";

/**
 * AgentTodoPanel — circular button + popover that surfaces the agent's
 * live task plan for the active session.
 *
 * Lifecycle:
 * - The whole component renders only when there is something to show
 *   (`enabled && !empty`). When the agent has not called `agent_todo`
 *   (or the tool is disabled in settings), nothing appears in the chat
 *   area — same "don't render when empty" semantic as the prior
 *   always-on left-floating panel.
 * - While rendered, the button is always visible (affordance is stable);
 *   hovering it (`mouseenter`) opens the popover, running the popover's
 *   scale-fade transition. Moving the mouse away (`mouseleave`) schedules
 *   a close after HOVER_CLOSE_DELAY — the grace period lets the pointer
 *   cross the 8px gap between button and popover without the popover
 *   closing underneath it. Clicking the button still toggles `open`
 *   (quick dismiss while open; keyboard users can still summon it).
 *
 * Popover positioning:
 * - Button + popover share a `position: relative` wrapper so the popover
 *   can anchor to its top-right corner via `bottom: calc(100% + 8px);
 *   right: 0`. The popover sits directly above the button, extending
 *   leftward into the chat whitespace, with its right edge flush to the
 *   button's right edge. Width 320px, height 240px (then scrolls).
 * - Popover stays mounted at all times (so toggling `open` runs the
 *   transition both ways) but starts at `opacity: 0; transform:
 *   scale(0.96); pointer-events: none`. `transform-origin: bottom
 *   right` anchors the scale to the button's footprint, so the popover
 *   visibly grows out of the launcher rather than the page center.
 *
 * Close paths:
 * - `mouseleave` on the wrapper (after HOVER_CLOSE_DELAY, so moving onto
 *   the popover itself doesn't close it).
 * - Button click toggles `open` (same button, second click closes).
 * - `keydown` Escape closes.
 *
 * Responsive:
 * - Below 1100px the whole component (button + popover) is hidden.
 *   Matches the prior panel's breakpoint — the chat area's whitespace
 *   shrinks below this point and a 320px surface would occlude messages.
 *
 * Visual state:
 * - Tasks are still rendered as a flat id-ascending list (same as
 *   before). In-progress gets a loading icon, `var(--accent)` text + a
 *   2.6s linear gradient sweep; completed gets an accent check +
 *   `var(--text-dim)` text; pending is the default text color. The whole
 *   panel remains a read-only status display.
 * - When there's an in-progress task, the launcher button shows a small
 *   accent dot at its top-right with a matching 2.6s pulse — the same
 *   cadence as the text sweep so "live" reads consistently wherever it
 *   appears. Hidden when no task is in progress.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentTask } from "@/lib/agent-todo-tool/types";
import { useAgentTodo } from "@/hooks/useAgentTodo";
import { useI18n } from "@/hooks/useI18n";
import { InlineLoader } from "generative-loaders";

const PANEL_BREAKPOINT = 1100;
/** Grace period (ms) before closing after the pointer leaves the wrapper —
    long enough to cross the 8px button→popover gap without flicker. */
const HOVER_CLOSE_DELAY = 200;

interface TaskRowProps {
  task: AgentTask;
  /** Whether this is the last task in the list — suppresses trailing divider. */
  isLast: boolean;
}

const TaskRow = memo(function TaskRow({ task, isLast }: TaskRowProps) {
  const isInProgress = task.status === "in_progress";
  const isCompleted = task.status === "completed";
  const subjectColor = isCompleted
    ? "var(--text-dim)"
    : isInProgress
      ? "var(--accent)"
      : "var(--text)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        border: "none",
        borderBottom: isLast ? "none" : "1px solid var(--border)",
        background: "transparent",
        color: "var(--text)",
      }}
    >
      <span
        aria-hidden="true"
        className="agent-todo-status-icon"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 15,
          height: 18,
          flexShrink: 0,
          marginTop: 1,
          color: isCompleted || isInProgress ? "var(--accent)" : "transparent",
        }}
      >
        {isCompleted ? (
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 8.25 6.25 11.25 13 4.5" />
          </svg>
        ) : isInProgress ? (
          <InlineLoader variant="signal" size={15} color="var(--accent)" />
        ) : null}
      </span>
      <div
        style={{
          minWidth: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          className={isInProgress ? "agent-todo-live agent-todo-live--accent" : undefined}
          style={{
            fontSize: 13,
            lineHeight: 1.4,
            color: subjectColor,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {task.subject}
        </span>
        {isInProgress && task.description ? (
          <span
            style={{
              fontSize: 11,
              lineHeight: 1.4,
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              wordBreak: "break-word",
            }}
          >
            {task.description}
          </span>
        ) : null}
      </div>
    </div>
  );
});

export const AgentTodoPanel = memo(function AgentTodoPanel({
  sessionId,
  refreshKey,
}: {
  sessionId: string | null;
  refreshKey: number;
}) {
  const { tasks, empty, enabled } = useAgentTodo(sessionId, refreshKey);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  // Hover summon: entering the wrapper opens immediately; leaving
  // schedules a close after HOVER_CLOSE_DELAY. The timer is what makes
  // the 8px button→popover gap crossable — a fast pointer move over the
  // gap fires mouseleave then mouseenter on the wrapper, and the
  // enter-side cancels the pending close. The popover is a DOM child of
  // the wrapper, so moving onto it never fires mouseleave at all.
  const handleMouseEnter = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handleMouseLeave = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, HOVER_CLOSE_DELAY);
  }, [clearCloseTimer]);

  // Clear any pending close timer on unmount.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Esc closes. Bound while open only.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Click still toggles — a quick dismiss while hovered open, and the
  // only way a keyboard user (focus + Enter/Space) can summon it.
  const handleButtonClick = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  // Flat id-ascending list — visual state is the only status cue.
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.id - b.id),
    [tasks],
  );
  const firstInProgress = sortedTasks.find((t) => t.status === "in_progress");
  const hasInProgress = !!firstInProgress;

  if (!enabled || empty) return null;

  return (
    <>
      <style>{`
        @media (max-width: ${PANEL_BREAKPOINT - 1}px) {
          .agent-todo-launcher { display: none !important; }
        }
      `}</style>
      <div
        className="agent-todo-launcher relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <button
          type="button"
          onClick={handleButtonClick}
          aria-label={t("Agent Plan")}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110"
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--border)",
            color: "var(--text-muted)",
            position: "relative",
          }}
        >
            {/* 3-row checklist icon — three lines with checkmarks on the
                first column, plain rows on the second column. Distinct
                from SessionLibrary (2x2 grid), Collapse all (chevrons),
                and Scroll to bottom (single chevron). */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="3 6 5.5 8.5 10 4" />
              <line x1="13" y1="6" x2="20" y2="6" />
              <polyline points="3 13 5.5 15.5 10 11" />
              <line x1="13" y1="13" x2="20" y2="13" />
              <polyline points="3 20 5.5 22.5 10 18" />
              <line x1="13" y1="20" x2="20" y2="20" />
            </svg>
            {hasInProgress && (
              <span
                aria-hidden="true"
                className="agent-todo-launcher-dot"
                style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  boxShadow: "0 0 0 2px var(--bg-panel)",
                }}
              />
            )}
          </button>
        {/*
          Always-mounted popover. Toggling `open` runs scale + opacity
          in 180ms cubic-bezier(0.32, 0.72, 0, 1) — same easing as the
          prior panel so motion language stays consistent. The inner
          body's max-height still tween handles the actual content
          height change; the outer scale-fade is purely the "growing out
          of the button" effect.
        */}
        <div
          role="dialog"
          aria-label={t("Agent Plan")}
          className="agent-todo-popover"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            width: 320,
            // No maxHeight here on purpose. The popover's containing block
            // is the launcher wrapper (36px tall — just the button), so a
            // percentage would resolve to a tiny value and crush the panel.
            // The inner body's maxHeight: 240 already caps the content
            // height (240 body + 16 padding = 256px popover upper bound).
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: "10px 6px",
            background: "color-mix(in srgb, var(--bg-panel) 50%, transparent)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            zIndex: 20,
            fontFamily: "var(--font-sans)",
            transformOrigin: "bottom right",
            transform: open ? "scale(1)" : "scale(0.96)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition:
              "transform 180ms cubic-bezier(0.32, 0.72, 0, 1), opacity 180ms cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          <div
            className="agent-todo-body"
            style={{
              maxHeight: open ? 240 : 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              transition: "max-height 180ms cubic-bezier(0.32, 0.72, 0, 1)",
            }}
          >
            <div data-scroll-wide style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {sortedTasks.map((task, idx) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isLast={idx === sortedTasks.length - 1}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <style>{`
        /* Gradient sweep on the in-progress subject text. The gradient
           spans 3x the element width so the highlight spends most of
           the cycle off-screen — that gap between passes is what keeps
           it calm rather than a constant strobe. -webkit-text-fill-color
           is the only thing made transparent (not color), so the
           reduced-motion fallback just restores currentColor. */
        .agent-todo-live {
          background-size: 300% 100%;
          background-repeat: no-repeat;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: agent-todo-live-sweep 2.6s linear infinite;
        }
        .agent-todo-live--accent {
          background-image: linear-gradient(100deg,
            var(--accent) 0%, var(--accent) 44%,
            color-mix(in srgb, var(--accent) 45%, #fff) 50%,
            var(--accent) 56%, var(--accent) 100%);
        }
        @keyframes agent-todo-live-sweep {
          from { background-position: 100% 0; }
          to   { background-position: 0% 0; }
        }
        /* Launcher dot pulse — same 2.6s cadence as the text sweep so
           "live" reads the same in both places. Subtle scale + opacity
           loop; the inner boxShadow ring around the dot gives it the
           same "above the surface" feel as SessionLibrary's red badge. */
        .agent-todo-launcher-dot {
          animation: agent-todo-launcher-pulse 2.6s linear infinite;
        }
        @keyframes agent-todo-launcher-pulse {
          0%, 100% { transform: scale(1);   opacity: 1;   }
          50%      { transform: scale(1.2); opacity: 0.7; }
        }
        @media (prefers-reduced-motion: reduce) {
          .agent-todo-live {
            animation: none;
            background-image: none;
            -webkit-text-fill-color: currentColor;
          }
          .agent-todo-launcher-dot {
            animation: none;
          }
          /* Fold/unfold motion collapses to zero — every animated
             property snaps to its target. */
          .agent-todo-popover,
          .agent-todo-body {
            transition: none !important;
          }
        }
      `}</style>
    </>
  );
});