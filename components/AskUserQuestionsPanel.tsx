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
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  clearPendingAskUserQuestions,
  getPendingAskUserQuestions,
  useAskUserQuestionsSubmit,
  usePendingAskUserQuestions,
  type PendingAskUserQuestions,
} from "@/hooks/askUserQuestionsStore";
import { Tooltip } from "./Tooltip";
import {
  ASK_USER_QUESTIONS_OTHER_LABEL,
  hasUnansweredRequired,
  isOtherOptionLabel,
  isQuestionAnswered,
  type AskUserQuestion,
  type AskUserQuestionAnswer,
} from "@/lib/ask-user-questions-tool-types";

/** Fixed pixel height of the sticky panel — chosen to fit one question
 *  card with options + a small footer without dominating the chat. The
 *  tab bar at the top and the Submit/Cancel row at the bottom sit inside
 *  this height; only the question card scrolls. */
const PANEL_HEIGHT_PX = 280;

/** Delay before auto-advancing to the next question after a single-select
 *  pick — long enough to register the choice, short enough to feel snappy. */
const AUTO_ADVANCE_MS = 450;

/** Slightly longer window before auto-submitting on the last question so a
 *  stray click doesn't fire the tool before the user can notice. */
const AUTO_SUBMIT_MS = 700;

/** How long the "Answers sent" confirmation stays before the panel closes. */
const SENT_VIEW_MS = 1400;

interface Props {
  sessionId: string | null;
  /** Invoked when a new `ask_user_questions` request appears (the panel
   *  renders from scratch). Used by ChatWindow to force-scroll the message
   *  list to the bottom so the question sits against the latest messages. */
  onAppear?: () => void;
}

export function AskUserQuestionsPanel({ sessionId, onAppear }: Props) {
  const { t } = useI18n();
  const pending = usePendingAskUserQuestions(sessionId);
  const submit = useAskUserQuestionsSubmit();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Local form state mirrors the questions in `pending`. Indexed by
  // questionIndex so multi-question panels update independently.
  const [answers, setAnswers] = useState<AskUserQuestionAnswer[]>([]);
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  // Which tab is currently visible. Always within [0, count). Reset to 0
  // every time a new request arrives (see the effect below).
  const [activeTab, setActiveTab] = useState(0);
  /** True while the "Answers sent ✓" confirmation is showing. The store
   *  entry stays put during this window (the panel schedules the clear),
   *  so the confirmation survives the round-trip to the server. */
  const [sent, setSent] = useState(false);
  /** Collapsed to a slim bar. The request stays pending — the agent keeps
   *  waiting, the user can expand and answer later (or Cancel). */
  const [minimized, setMinimized] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────
  // pendingRef / answersRef / otherTextsRef: the auto-advance, auto-submit
  // and sent-close timers fire after state has committed, so they read the
  // latest values through these refs instead of stale closures.
  const pendingRef = useRef<PendingAskUserQuestions | null>(null);
  const answersRef = useRef<AskUserQuestionAnswer[]>([]);
  const otherTextsRef = useRef<Record<number, string>>({});
  const submittingRef = useRef(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The request we successfully submitted, remembered until its store
   *  entry is gone — used to drop a stale entry if the panel moves on
   *  (session switch / new request / unmount) before the sent-timer fired. */
  const submittedRef = useRef<{ sessionId: string; toolCallId: string } | null>(null);
  const tabScrollRef = useRef<HTMLDivElement | null>(null);

  pendingRef.current = pending;
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    otherTextsRef.current = otherTexts;
  }, [otherTexts]);
  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  // Derived counts — computed here (before the hooks that depend on them)
  // because the scroll-reset effect below uses safeTab, and it must be
  // declared before any early return.
  const count = pending?.questions.length ?? 0;
  const safeTab = Math.min(Math.max(activeTab, 0), Math.max(count - 1, 0));

  /** Drop the store entry for a request we already submitted when the panel
   *  moves on before its sent-timer fired. Guarded by toolCallId so a newer
   *  request for the same session is never touched. */
  const clearStaleSubmitted = useCallback(() => {
    const sub = submittedRef.current;
    if (!sub) return;
    const cur = getPendingAskUserQuestions(sub.sessionId);
    if (cur && cur.toolCallId === sub.toolCallId) {
      clearPendingAskUserQuestions(sub.sessionId);
    }
    submittedRef.current = null;
  }, []);

  // Reset form state when the pending question changes (new request) or
  // disappears (resolved). Cancels any in-flight timers so a stale
  // auto-advance / auto-submit / sent-close can't fire on the new state.
  useEffect(() => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (sentTimerRef.current) {
      clearTimeout(sentTimerRef.current);
      sentTimerRef.current = null;
    }
    clearStaleSubmitted();
    if (!pending) {
      setAnswers([]);
      setOtherTexts({});
      setActiveTab(0);
      setSubmitError(null);
      setMinimized(false);
      setSent(false);
      return;
    }
    setAnswers(
      pending.questions.map((_, i) => ({
        questionIndex: i,
        selectedLabels: [],
        otherText: null,
      })),
    );
    setOtherTexts({});
    setActiveTab(0);
    setSubmitError(null);
    setMinimized(false);
    setSent(false);
  }, [pending, clearStaleSubmitted]);

  // When a new `ask_user_questions` request appears (pending transitions to
  // non-null), tell ChatWindow to force-scroll the chat to the bottom so the
  // newly surfaced panel sits against the latest messages. Store reference is
  // stable for a given request (server re-emits no-op on reconnect), so this
  // only fires once per request.
  useEffect(() => {
    if (pending) onAppear?.();
  }, [pending, onAppear]);

  // Unmount: cancel timers and drop a submitted-but-not-yet-cleared entry.
  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
      clearStaleSubmitted();
    };
  }, [clearStaleSubmitted]);

  /** Build the wire answers for the whole batch from the committed form
   *  state (baking typed "Other" text in so the server skips re-parsing). */
  const buildFinalAnswers = useCallback(
    (questions: readonly AskUserQuestion[]): AskUserQuestionAnswer[] =>
      questions.map((q, i) => {
        const a = answersRef.current[i] ?? {
          questionIndex: i,
          selectedLabels: [],
          otherText: null,
        };
        const hasOther = a.selectedLabels.some(isOtherOptionLabel);
        return {
          questionIndex: i,
          // UI text wins over the mirrored copy in answers (they can drift
          // after an exclusive Other switch, see updateSelection).
          selectedLabels: a.selectedLabels,
          otherText: hasOther
            ? (otherTextsRef.current[i] ?? a.otherText ?? "").trim()
            : null,
        };
      }),
    [],
  );

  /** Shared submit path (manual Submit button + auto-submit). Shows the
   *  "Answers sent" confirmation on success, then clears the store entry
   *  a beat later so the panel closes. */
  const doSubmit = useCallback(
    async (finalAnswers: AskUserQuestionAnswer[]) => {
      const p = pendingRef.current;
      if (!p || !sessionId) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        await submit(sessionId, p.toolCallId, { answers: finalAnswers });
        submittedRef.current = { sessionId, toolCallId: p.toolCallId };
        setSent(true);
        sentTimerRef.current = setTimeout(() => {
          sentTimerRef.current = null;
          clearPendingAskUserQuestions(sessionId);
        }, SENT_VIEW_MS);
      } catch (e) {
        setSent(false);
        setSubmitError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [sessionId, submit],
  );

  /** Auto-submit after the last question's single-select pick. Fires only
   *  when every required question has a real answer — otherwise the user
   *  must finish manually. */
  const maybeAutoSubmit = useCallback(() => {
    if (submittingRef.current) return;
    const p = pendingRef.current;
    if (!p) return;
    const finalAnswers = buildFinalAnswers(p.questions);
    if (hasUnansweredRequired(p.questions, finalAnswers)) return;
    void doSubmit(finalAnswers);
  }, [buildFinalAnswers, doSubmit]);

  const updateSelection = useCallback(
    (qIdx: number, label: string, checked: boolean, multi: boolean) => {
      setAnswers((prev) => {
        const next = prev.slice();
        const current = next[qIdx] ?? {
          questionIndex: qIdx,
          selectedLabels: [],
          otherText: null,
        };
        const isOther = isOtherOptionLabel(label);
        let labels: string[];
        if (checked && isOther) {
          // 「其他」即独占：无论单选/多选，选中时清空所有预设选项，只留它。
          labels = [label];
        } else if (checked) {
          // 互斥：选中预设选项时剔除已选的「其他」，释放自由输入。
          const rest = current.selectedLabels.filter((l) => !isOtherOptionLabel(l));
          labels = multi
            ? rest.includes(label)
              ? rest
              : [...rest, label]
            : [label];
        } else {
          labels = multi
            ? current.selectedLabels.filter((l) => l !== label)
            : [];
        }
        const hasOther = labels.some(isOtherOptionLabel);
        next[qIdx] = {
          questionIndex: qIdx,
          selectedLabels: labels,
          // Restore the previously typed free-text when re-selecting
          // "Other" after an exclusive switch cleared it — the UI text
          // (otherTexts) is the authoritative copy, answers mirrors it.
          otherText: hasOther
            ? (otherTextsRef.current[qIdx] ?? current.otherText ?? "")
            : null,
        };
        return next;
      });

      // Reference-card behavior: a single-select pick auto-advances to the
      // next question; on the last question it auto-submits. "Other" never
      // auto-advances — the user still has to type its text.
      if (!multi && checked && !isOtherOptionLabel(label)) {
        if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
        const total = pendingRef.current?.questions.length ?? 1;
        const isLast = qIdx === total - 1;
        advanceTimerRef.current = setTimeout(() => {
          advanceTimerRef.current = null;
          if (isLast) {
            maybeAutoSubmit();
          } else {
            setActiveTab((cur) => Math.min(total - 1, cur + 1));
          }
        }, isLast ? AUTO_SUBMIT_MS : AUTO_ADVANCE_MS);
      }
    },
    [maybeAutoSubmit],
  );

  const updateOtherText = useCallback((qIdx: number, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [qIdx]: text }));
    setAnswers((prev) => {
      const next = prev.slice();
      const cur = next[qIdx];
      if (!cur) return prev;
      if (!cur.selectedLabels.some(isOtherOptionLabel)) return prev;
      next[qIdx] = { ...cur, otherText: text };
      return next;
    });
  }, []);

  const canSubmit = useMemo(() => {
    if (!pending) return false;
    if (submitting || sent) return false;
    return !hasUnansweredRequired(pending.questions, answers);
  }, [pending, answers, submitting, sent]);

  const handleSubmit = useCallback(async () => {
    const p = pendingRef.current;
    if (!p || !canSubmit) return;
    void doSubmit(buildFinalAnswers(p.questions));
  }, [canSubmit, doSubmit, buildFinalAnswers]);

  const handleCancel = useCallback(async () => {
    const p = pendingRef.current;
    if (!p || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submit(sessionId!, p.toolCallId, { cancelled: true });
      // No confirmation state for cancel — the panel just closes. A
      // network-level failure keeps the entry so the user can retry.
      clearPendingAskUserQuestions(p.sessionId);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, submit, submitting]);

  // Keyboard nav: ←/→ on the tab bar moves between tabs. Only intercepts
  // when focus is on the tab bar itself — focusing into a question's
  // option or the Other text input leaves arrow keys alone so the user
  // can move the caret as usual.
  const handleTabListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const total = pending?.questions.length ?? 0;
      if (total <= 1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActiveTab((i) => (i - 1 + total) % total);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setActiveTab((i) => (i + 1) % total);
      } else if (e.key === "Home") {
        e.preventDefault();
        setActiveTab(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setActiveTab(total - 1);
      }
    },
    [pending],
  );

  // Reset the question card's scroll when switching tabs (and when a new
  // request replaces the current one mid-scroll).
  useEffect(() => {
    tabScrollRef.current?.scrollTo({ top: 0 });
  }, [safeTab, pending]);

  // Hooks above this line must be unconditional. The early returns are
  // placed after all hooks so rules-of-hooks is satisfied.
  if (!pending) return null;

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
      <div
        role="region"
        aria-label={regionLabel}
        onClick={() => setMinimized(false)}
        className="ask-panel-in"
        style={{
          margin: "0 12px 8px 12px",
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
    );
  }

  return (
    <div
      role="region"
      aria-label={regionLabel}
      className="ask-panel-in"
      style={{
        // Plain background (matches other panels in the app). The shadow +
        // border alone carry the "this is a focused interaction surface"
        // affordance; tinting with the accent color made the panel feel
        // louder than necessary when it's a regular in-app UI element.
        margin: "0 12px 8px 12px",
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
      <style>{`
        @keyframes ask-panel-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes askq-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ask-panel-in { animation: ask-panel-in 180ms ease-out; }
        .askq-fade-up { animation: askq-fade-up 220ms ease-out; }
        .askq-fade-up-delayed { animation: askq-fade-up 350ms ease-out 120ms both; }
        .askq-sent-pop { animation: saved-pop 0.45s ease; }
        .askq-sent-check { animation: saved-check-draw 0.35s ease forwards; }
        .askq-icon-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;
          background: transparent; border: none; cursor: pointer;
          color: var(--text-dim); transition: color 0.1s, background-color 0.1s;
        }
        .askq-icon-btn:hover { background: var(--bg-hover); color: var(--text); }
        .askq-icon-btn:disabled { opacity: 0.35; cursor: default; }
        .askq-icon-btn:disabled:hover { background: transparent; color: var(--text-dim); }
        @media (prefers-reduced-motion: reduce) {
          .ask-panel-in, .askq-fade-up, .askq-fade-up-delayed,
          .askq-sent-pop, .askq-sent-check {
            animation: none !important;
          }
        }
      `}</style>

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
            {(() => {
              const q = pending.questions[safeTab];
              if (!q) return null;
              return (
                <QuestionCard
                  question={q}
                  answer={answers[safeTab]}
                  otherText={otherTexts[safeTab] ?? ""}
                  onToggle={(label, checked) =>
                    updateSelection(safeTab, label, checked, q.multiSelect)
                  }
                  onOtherTextChange={(text) => updateOtherText(safeTab, text)}
                  // Single-question panel has no tab bar, so the collapse
                  // button lives in the card header row instead.
                  action={count === 1 ? collapseButton : undefined}
                />
              );
            })()}
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
  );
}

interface QuestionCardProps {
  question: AskUserQuestion;
  answer: AskUserQuestionAnswer | undefined;
  otherText: string;
  onToggle: (label: string, checked: boolean) => void;
  onOtherTextChange: (text: string) => void;
  /** Extra element rendered at the top-right of the card header row
   *  (used for the collapse button on single-question panels). */
  action?: ReactNode;
}

function QuestionCard({
  question,
  answer,
  otherText,
  onToggle,
  onOtherTextChange,
  action,
}: QuestionCardProps) {
  const { t } = useI18n();
  const selectedSet = useMemo(
    () => new Set(answer?.selectedLabels ?? []),
    [answer?.selectedLabels],
  );
  const otherSelected = selectedSet.has(ASK_USER_QUESTIONS_OTHER_LABEL);

  return (
    <div
      style={{
        padding: "4px 0 10px 0",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Question text (plus the optional header action, e.g. collapse).
          The header chip is already shown on the tab above, so it's not
          repeated here. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            color: "var(--text)",
            lineHeight: 1.5,
          }}
        >
          {question.question}
        </div>
        {action}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {/* Always append a fixed free-text option at the end, regardless of
            what options the agent authored (even if it also included an
            "Other" label). It renders the localized word but keeps the
            English semantic label so isOtherOptionLabel still matches. */}
        {[
          ...question.options,
          { label: ASK_USER_QUESTIONS_OTHER_LABEL, description: "" },
        ].map((opt, i) => {
          const checked = selectedSet.has(opt.label);
          const isOther = isOtherOptionLabel(opt.label);
          const inputId = `ask-opt-${question.header}-${i}`.replace(/\s+/g, "-");
          return (
            <div key={inputId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <label
                htmlFor={inputId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: checked
                    ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                    : "transparent",
                  border: checked
                    ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)"
                    : "1px solid transparent",
                  transition: "background 0.1s, border-color 0.1s",
                }}
              >
                <input
                  id={inputId}
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={`ask-q-${question.header}`}
                  checked={checked}
                  onChange={(e) => onToggle(opt.label, e.target.checked)}
                  style={{
                    marginTop: 2,
                    accentColor: "var(--accent)",
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
                    {isOther ? t("Other") : opt.label}
                  </span>
                  {opt.description && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        lineHeight: 1.4,
                      }}
                    >
                      {opt.description}
                    </span>
                  )}
                </span>
              </label>
              {/* Free-text input appears when Other is selected. In single-
                  select mode it replaces the radio behavior visually; in
                  multi-select it sits alongside the checked checkbox. */}
              {isOther && otherSelected && (
                <input
                  type="text"
                  value={otherText}
                  onChange={(e) => onOtherTextChange(e.target.value)}
                  placeholder={t("Type your own answer…")}
                  // Don't autofocus — would steal focus from the chat input
                  // and break the "user can still type in ChatInput"
                  // decision. Click to focus instead.
                  style={{
                    marginLeft: 26,
                    marginTop: 2,
                    padding: "5px 8px",
                    fontSize: 12,
                    fontFamily: "inherit",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: "var(--text)",
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
