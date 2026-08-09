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
 *      bar switch tabs; Home/End jump to first/last.
 *   2. Active question card: only the visible tab's question renders
 *      here, with its own internal scroll. The question's long-form text
 *      is shown; the header chip is NOT repeated (it lives on the tab).
 *   3. Footer: Submit + Cancel always visible at the bottom so the user
 *      doesn't have to scroll the question card to find them. Both
 *      buttons are right-aligned; Cancel uses a red border + red text on
 *      a transparent background; Submit uses the theme accent.
 *
 * Data flow:
 *   - `askUserQuestionsStore` carries one pending entry per sessionId.
 *   - On mount / store change, we read the entry for our sessionId.
 *   - When the user clicks Submit, we POST the decision to
 *     `/api/agent/[id]` with `type: "ask_user_questions_decision"`,
 *     clear the local store entry, and the SSE handler on the server
 *     resolves the wrapper Promise — the tool then continues.
 *   - When the user clicks Cancel, we POST the same shape with
 *     `{cancelled: true}`.
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  useAskUserQuestionsSubmit,
  usePendingAskUserQuestions,
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
const PANEL_HEIGHT_PX = 360;

interface Props {
  sessionId: string | null;
}

export function AskUserQuestionsPanel({ sessionId }: Props) {
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

  // Reset form state when the pending question changes (new request) or
  // disappears (resolved). Default each question's answer to an empty
  // selection.
  useEffect(() => {
    if (!pending) {
      setAnswers([]);
      setOtherTexts({});
      setActiveTab(0);
      setSubmitError(null);
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
  }, [pending]);

  const updateSelection = useCallback(
    (qIdx: number, label: string, checked: boolean, multi: boolean) => {
      setAnswers((prev) => {
        const next = prev.slice();
        const current = next[qIdx] ?? {
          questionIndex: qIdx,
          selectedLabels: [],
          otherText: null,
        };
        let labels: string[];
        if (multi) {
          labels = checked
            ? current.selectedLabels.includes(label)
              ? current.selectedLabels
              : [...current.selectedLabels, label]
            : current.selectedLabels.filter((l) => l !== label);
        } else {
          labels = checked ? [label] : [];
        }
        const hasOther = labels.some(isOtherOptionLabel);
        next[qIdx] = {
          questionIndex: qIdx,
          selectedLabels: labels,
          otherText: hasOther ? (current.otherText ?? "") : null,
        };
        return next;
      });
    },
    [],
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
    if (submitting) return false;
    return !hasUnansweredRequired(pending.questions, answers);
  }, [pending, answers, submitting]);

  const handleSubmit = useCallback(async () => {
    if (!pending || !sessionId || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Bake the typed text into the answers payload so the server can
      // skip re-parsing the per-question otherText field.
      const finalAnswers: AskUserQuestionAnswer[] = pending.questions.map((q, i) => {
        const a = answers[i] ?? {
          questionIndex: i,
          selectedLabels: [],
          otherText: null,
        };
        const hasOther = a.selectedLabels.some(isOtherOptionLabel);
        return {
          questionIndex: i,
          selectedLabels: a.selectedLabels,
          otherText: hasOther ? (a.otherText ?? otherTexts[i] ?? "").trim() : null,
        };
      });
      await submit(sessionId, pending.toolCallId, { answers: finalAnswers });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [pending, sessionId, canSubmit, answers, otherTexts, submit]);

  const handleCancel = useCallback(async () => {
    if (!pending || !sessionId || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submit(sessionId, pending.toolCallId, { cancelled: true });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [pending, sessionId, submitting, submit]);

  // Keyboard nav: ←/→ on the tab bar moves between tabs. Only intercepts
  // when focus is on the tab bar itself — focusing into a question's
  // option or the Other text input leaves arrow keys alone so the user
  // can move the caret as usual. Must be declared before the early return
  // so hooks run in the same order every render.
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

  // Hooks above this line must be unconditional. The early return is
  // placed after all hooks so rules-of-hooks is satisfied.
  if (!pending) return null;

  const count = pending.questions.length;
  // Defensive: clamp activeTab if the question count shrank (e.g. a new
  // request arrived with fewer questions than the prior batch). The reset
  // effect handles the common case; this covers re-render races.
  const safeTab = Math.min(Math.max(activeTab, 0), Math.max(count - 1, 0));
  // aria-label for the panel: kept short — the tab list has its own
  // descriptive label, so the region just needs a name for screen readers.
  const regionLabel = count === 1
    ? t("Ask User Questions")
    : t("{n} questions pending").replace("{n}", String(count));

  return (
    <div
      role="region"
      aria-label={regionLabel}
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
        // Slide-in animation so a new question doesn't pop jarringly.
        animation: "ask-panel-in 180ms ease-out",
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
        @media (prefers-reduced-motion: reduce) {
          .ask-panel-in { animation: none !important; }
        }
      `}</style>

      {/* ── Tab bar (hidden when there's only one question) ── */}
      {count > 1 && (
        <div
          role="tablist"
          aria-label={regionLabel}
          onKeyDown={handleTabListKeyDown}
          style={{
            display: "flex",
            gap: 2,
            // Top padding gives the tabs breathing room from the panel
            // edge; the header row that used to sit here is gone, so the
            // tab row is now the topmost element and needs explicit
            // vertical spacing instead of relying on header bottom
            // padding.
            padding: "8px 10px 0 10px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
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
      )}

      {/* ── Active question (only render the visible tab's card) ── */}
      <div
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
            />
          );
        })()}
      </div>

      {/* ── Footer: optional error + Submit/Cancel row ── */}
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
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "8px 14px 10px 14px",
          borderTop: "1px solid var(--border)",
          gap: 8,
          flexShrink: 0,
        }}
      >
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
      </div>
    </div>
  );
}

interface QuestionCardProps {
  question: AskUserQuestion;
  answer: AskUserQuestionAnswer | undefined;
  otherText: string;
  onToggle: (label: string, checked: boolean) => void;
  onOtherTextChange: (text: string) => void;
}

function QuestionCard({
  question,
  answer,
  otherText,
  onToggle,
  onOtherTextChange,
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
      {/* Question text only — the header chip is already shown on the tab
          above, so re-rendering it here would be redundant visual noise. */}
      <div
        style={{
          fontSize: 13,
          color: "var(--text)",
          lineHeight: 1.5,
        }}
      >
        {question.question}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {question.options.map((opt) => {
          const checked = selectedSet.has(opt.label);
          const isOther = isOtherOptionLabel(opt.label);
          const inputId = `ask-opt-${question.header}-${opt.label}`.replace(/\s+/g, "-");
          return (
            <div key={opt.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
                    {opt.label}
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