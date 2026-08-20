"use client";

/**
 * Sticky panel rendered directly above ChatInput when the agent has called
 * `ask_user_questions`. Always at the bottom of the user's view (because
 * ChatInput is always at the bottom), so the user can't miss it.
 *
 * Layout: a fixed-height column with three zones —
 *   1. Tab bar (when count > 1): one tab per question. Each tab shows a
 *      status dot (filled = answered, hollow = not) and the question's
 *      `header` chip text. Required tabs render the header text in the
 *      accent color (instead of a separate red asterisk). ←/→ on the tab
 *      bar switch tabs; Home/End jump to first/last. A collapse button
 *      sits at the right end of the row (see "Collapse" below).
 *   2. Active question card: only the visible tab's question renders
 *      here, with its own internal scroll. The question's long-form text
 *      is shown; the header chip is NOT repeated (it lives on the tab).
 *   3. Footer: prev/next arrows (multi-question panels) + Submit + Cancel
 *      always visible at the bottom so the user doesn't have to scroll
 *      the question card to find them. Cancel uses a red border + red
 *      text on a transparent background; Submit uses the theme accent.
 *
 * Interaction model (borrowed from the "approval card" reference):
 *   - A single-select (radio) pick auto-advances to the next question
 *     after a short beat; on the last question it auto-submits when every
 *     required question has a real answer. "Other" never auto-advances —
 *     the user still has to type. Multi-select (checkbox) questions wait
 *     for the user to move on (Submit / tab / arrow).
 *   - Question switches are animated (fade-up) and reset the card scroll.
 *   - After Submit, a brief "Answers sent ✓" confirmation shows before
 *     the panel closes.
 *   - The collapse button shrinks the panel to a slim "N questions
 *     pending" bar. The request stays pending — the agent keeps waiting,
 *     the user can expand and answer later (or Cancel).
 *
 * Data flow:
 *   - `askUserQuestionsStore` carries one pending entry per sessionId.
 *   - On mount / store change, we read the entry for our sessionId.
 *   - When the user clicks Submit, we POST the decision to
 *     `/api/agent/[id]` with `type: "ask_user_questions_decision"`; the
 *     SSE handler on the server resolves the wrapper Promise and the tool
 *     continues. The store entry is kept alive during the "Answers sent"
 *     confirmation and cleared a beat later (the panel schedules it).
 *   - When the user clicks Cancel, we POST the same shape with
 *     `{cancelled: true}` and drop the entry immediately.
 *
 * UX rules:
 *   - multiSelect=false: each option is a radio. Selecting one replaces
 *     the previous choice. "Other" is the special label that, when
 *     selected, surfaces a single-line text input.
 *   - multiSelect=true: each option is a checkbox. "Other" alongside a
 *     checkbox surfaces the text input without removing the box.
 *   - Submit is disabled when any required question has no answer, or when
 *     "Other" is selected but its text is empty (for a required question).
 *   - The panel itself never steals focus from the chat input — the user
 *     can still type in ChatInput while a question is pending.
 *
 * Component split:
 *   - `useAskUserQuestionsForm` lives next to this file and owns all
 *     form state + auto-submit/auto-advance bookkeeping. This file holds
 *     only the rendered chrome.
 *   - `QuestionCard` renders a single question; it's a pure presentation
 *     component driven by callbacks.
 *   - The CSS @keyframes + `.askq-icon-btn` class are defined once in
 *     `constants.ts` (the main panel's `<style>` block reads the literal).
 */

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";
import { isQuestionAnswered } from "@/lib/shared/ask-user-questions-tool-types";
import { useAskUserQuestionsForm } from "./ask-user-questions-panel/useAskUserQuestionsForm";
import { QuestionCard } from "./ask-user-questions-panel/QuestionCard";
import { ASK_PANEL_STYLES, PANEL_HEIGHT_PX } from "./ask-user-questions-panel/constants";

interface Props {
  sessionId: string | null;
  /** Invoked when a new `ask_user_questions` request appears (the panel
   *  renders from scratch). Used by ChatWindow to force-scroll the message
   *  list to the bottom so the question sits against the latest messages. */
  onAppear?: () => void;
}

export function AskUserQuestionsPanel({ sessionId, onAppear }: Props) {
  const { t } = useI18n();
  const form = useAskUserQuestionsForm({ sessionId, onAppear });

  if (!form.pending) return null;

  const {
    pending,
    safeTab,
    count,
    question,
    answers,
    otherTexts,
    submitting,
    submitError,
    sent,
    minimized,
    setMinimized,
    setActiveTab,
    canSubmit,
    handleSubmit,
    handleCancel,
    handleTabListKeyDown,
    updateSelection,
    updateOtherText,
    tabScrollRef,
  } = form;

  // aria-label for the panel: kept short — the tab list has its own
  // descriptive label, so the region just needs a name for screen readers.
  const regionLabel = count === 1
    ? t("Ask User Questions")
    : t("{n} questions pending").replace("{n}", String(count));

  const collapseButton = (
    <button
      type="button"
      aria-label={t("Collapse")}
      onClick={() => setMinimized(true)}
      className="askq-icon-btn"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );

  // Collapsed state: a slim bar that keeps the request pending. Clicking
  // the bar (or the expand button) restores the full panel with the
  // user's answers intact.
  if (minimized) {
    const barLabel = count === 1
      ? t("Awaiting your answer")
      : t("{n} questions pending").replace("{n}", String(count));
    return (
      // Outer wrapper is purely a spacing-bearing layer that mirrors
      // ChatInput's padding container (`padding: 0 16px` here; the full
      // panel below adds `0 16px 8px`). The actual surface lives inside
      // so its width tracks the same 820-wide centered column as
      // ChatInput instead of stretching edge-to-edge — keeps the
      // collapse bar flush with the input box on any chat-area width.
      <div
        className="ask-panel-in"
        style={{
          padding: "0 16px 8px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          role="region"
          aria-label={regionLabel}
          onClick={() => setMinimized(false)}
          style={{
            maxWidth: 820,
            margin: "0 auto",
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 6px 0 12px",
            height: 34,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 -4px 14px rgba(0, 0, 0, 0.12)",
            cursor: "pointer",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--accent)",
              animation: "ask-sidebar-pulse 1.6s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              flex: 1,
              fontSize: 12,
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {barLabel}
          </span>
          <button
            type="button"
            aria-label={t("Expand")}
            onClick={(e) => {
              e.stopPropagation();
              setMinimized(false);
            }}
            className="askq-icon-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    // Outer wrapper is purely spacing — mirrors ChatInput's padding
    // container (`padding: 0 16px 8px` here) so the panel's right edge
    // lines up with the input box on any chat-area width. The actual
    // surface (background / border / shadow) lives inside the inner div
    // below, which adds `maxWidth: 820 + margin: auto` — same pattern
    // ChatInput uses. Previous single-layer `margin: 0 12px 8px 12px`
    // stretched the surface edge-to-edge, drifting away from the input
    // box once the chat area was wider than ~852px.
    <div
      className="ask-panel-in"
      style={{
        padding: "0 16px 8px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        role="region"
        aria-label={regionLabel}
        style={{
          // Plain background (matches other panels in the app). The shadow +
          // border alone carry the "this is a focused interaction surface"
          // affordance; tinting with the accent color made the panel feel
          // louder than necessary when it's a regular in-app UI element.
          maxWidth: 820,
          margin: "0 auto",
          width: "100%",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 -4px 14px rgba(0, 0, 0, 0.12)",
          // Fixed height with a flex column so the tab bar and footer stay
          // pinned while only the active question's body scrolls.
          display: "flex",
          flexDirection: "column",
          height: PANEL_HEIGHT_PX,
          overflow: "hidden",
        }}
      >
      <style>{ASK_PANEL_STYLES}</style>

      {/* ── Tab bar (hidden when there's only one question) ── */}
      {!sent && count > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: "8px 8px 0 10px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div
            role="tablist"
            aria-label={regionLabel}
            onKeyDown={handleTabListKeyDown}
            style={{
              display: "flex",
              gap: 2,
              flex: 1,
              minWidth: 0,
              overflowX: "auto",
            }}
          >
            {pending.questions.map((q, qIdx) => {
              const isActive = qIdx === safeTab;
              // Tab dot is filled only when the question is *actually*
              // answered — i.e. selecting "Other" without typing anything
              // doesn't light it up. (See isQuestionAnswered in the types
              // module for the full definition.)
              const answered = isQuestionAnswered(answers[qIdx]);
              // Required tabs always use the accent color for the header text
              // (the affordance is "this tab title is theme-colored because
              // the question is mandatory"). Non-required tabs use the
              // standard active/muted colors. Keeps the indicator tied to
              // the tab itself rather than as a noisy red asterisk.
              const tabColor = q.required
                ? "var(--accent)"
                : (isActive ? "var(--text)" : "var(--text-muted)");
              // Tooltip shows the full header on hover. Headers are capped
              // at 12 chars and tab text at maxWidth 96px, so truncation is
              // uncommon, but a tooltip guarantees the user can always see
              // the full question identifier — useful when the header uses
              // wide characters or the panel is narrow.
              return (
                <Tooltip key={qIdx} content={q.header} side="bottom">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`ask-tabpanel-${qIdx}`}
                    id={`ask-tab-${qIdx}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setActiveTab(qIdx)}
                    style={{
                      position: "relative",
                      padding: "6px 12px 8px 8px",
                      fontSize: 12,
                      fontFamily: "inherit",
                      fontWeight: isActive ? 600 : 400,
                      color: tabColor,
                      background: "transparent",
                      border: "none",
                      borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      transition: "color 0.1s, border-color 0.1s",
                      flexShrink: 0,
                    }}
                  >
                    {/* Small status dot on the left of each tab. Filled accent
                        when the question has been answered; hollow border when
                        not. Distinct from the header pulse so they don't
                        read as the same signal. */}
                    <span
                      aria-hidden
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: answered
                          ? "var(--accent)"
                          : "transparent",
                        border: answered
                          ? "none"
                          : "1px solid var(--text-dim)",
                      }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 96 }}>
                      {q.header}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
          {collapseButton}
        </div>
      )}

      {/* ── Sent confirmation (replaces the card + tabs briefly) ── */}
      {sent ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 12,
          }}
        >
          <span
            aria-hidden
            className="askq-sent-pop"
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "#16a34a",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="askq-sent-check"
              style={{ strokeDasharray: 18 }}
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span
            className="askq-fade-up-delayed"
            style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}
          >
            {t("Answers sent")}
          </span>
          <span
            className="askq-fade-up-delayed"
            style={{ fontSize: 11, color: "var(--text-dim)" }}
          >
            {t("The agent is continuing…")}
          </span>
        </div>
      ) : (
        /* ── Active question (only render the visible tab's card) ── */
        <div
          ref={tabScrollRef}
          role="tabpanel"
          id={`ask-tabpanel-${safeTab}`}
          aria-labelledby={`ask-tab-${safeTab}`}
          data-scroll-wide
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "10px 14px 4px 14px",
          }}
        >
          {/* key={safeTab} remounts on every tab switch so the fade-up
              animation replays and the card starts at its top. */}
          <div key={safeTab} className="askq-fade-up">
            {question && (
              <QuestionCard
                question={question}
                answer={answers[safeTab]}
                otherText={otherTexts[safeTab] ?? ""}
                onToggle={(label, checked) =>
                  updateSelection(safeTab, label, checked, question.multiSelect)
                }
                onOtherTextChange={(text) => updateOtherText(safeTab, text)}
                // Single-question panel has no tab bar, so the collapse
                // button lives in the card header row instead.
                action={count === 1 ? collapseButton : undefined}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Footer: optional error + nav arrows + Submit/Cancel row ── */}
      {!sent && (
        <>
          {submitError && (
            <div
              style={{
                padding: "0 14px",
                flexShrink: 0,
                fontSize: 11,
                color: "#f87171",
              }}
            >
              {submitError}
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: count > 1 ? "space-between" : "flex-end",
              alignItems: "center",
              padding: "8px 14px 10px 14px",
              borderTop: "1px solid var(--border)",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {/* Prev / next — linear navigation for multi-question panels
                (the tab bar is the progress display). */}
            {count > 1 && (
              <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <button
                  type="button"
                  aria-label={t("Previous")}
                  disabled={safeTab === 0}
                  onClick={() => setActiveTab((cur) => Math.max(0, cur - 1))}
                  className="askq-icon-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={t("Next")}
                  disabled={safeTab === count - 1}
                  onClick={() => setActiveTab((cur) => Math.min(count - 1, cur + 1))}
                  className="askq-icon-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </span>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={handleCancel}
                disabled={submitting}
                style={{
                  padding: "5px 14px",
                  background: "transparent",
                  border: "1px solid #f87171",
                  borderRadius: 5,
                  color: "#f87171",
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{
                  padding: "5px 14px",
                  background: canSubmit ? "var(--accent)" : "var(--bg-hover)",
                  border: `1px solid ${canSubmit ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 5,
                  color: canSubmit ? "var(--bg)" : "var(--text-dim)",
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {t("Submit")}
              </button>
            </span>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
