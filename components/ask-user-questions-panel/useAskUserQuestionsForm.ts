"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  clearPendingAskUserQuestions,
  getPendingAskUserQuestions,
  useAskUserQuestionsSubmit,
  usePendingAskUserQuestions,
  type PendingAskUserQuestions,
} from "@/hooks/askUserQuestionsStore";
import {
  hasUnansweredRequired,
  isOtherOptionLabel,
  type AskUserQuestion,
  type AskUserQuestionAnswer,
} from "@/lib/ask-user-questions-tool-types";
import { AUTO_ADVANCE_MS, AUTO_SUBMIT_MS, SENT_VIEW_MS } from "./constants";

export interface AskUserQuestionsFormArgs {
  sessionId: string | null;
  /** Invoked when a new `ask_user_questions` request appears (the panel
   *  renders from scratch). Used by ChatWindow to force-scroll the message
   *  list to the bottom so the question sits against the latest messages. */
  onAppear?: () => void;
}

export interface AskUserQuestionsForm {
  /** The current pending entry, or null when no question is pending. */
  pending: PendingAskUserQuestions | null;
  /** Clamped active tab — guarded against out-of-range after pending changes. */
  safeTab: number;
  /** Length of the pending questions array (0 when no pending). */
  count: number;
  /** The question for the active tab, or null when there is no pending. */
  question: AskUserQuestion | null;
  /** Per-question answer state. Indexed by questionIndex. */
  answers: AskUserQuestionAnswer[];
  /** Per-question free-text for "Other". Indexed by questionIndex. */
  otherTexts: Record<number, string>;
  submitting: boolean;
  submitError: string | null;
  /** True while the "Answers sent" confirmation is showing. */
  sent: boolean;
  /** Collapsed to a slim bar. The request stays pending. */
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  activeTab: number;
  setActiveTab: Dispatch<SetStateAction<number>>;
  canSubmit: boolean;
  handleSubmit: () => void;
  handleCancel: () => void;
  /** ←/→/Home/End on the tab bar. */
  handleTabListKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  updateSelection: (qIdx: number, label: string, checked: boolean, multi: boolean) => void;
  updateOtherText: (qIdx: number, text: string) => void;
  /** Set on the active question's scroll container; the hook resets its
   *  scrollTop on every tab switch. */
  tabScrollRef: RefObject<HTMLDivElement | null>;
}

/** All state + auto-submit/auto-advance bookkeeping for `AskUserQuestionsPanel`.
 *
 *  Kept separate from the rendering component so the form state can be
 *  reasoned about without the ~300 lines of JSX, and so the rendered panel
 *  reads as a thin orchestrator. The hook also owns the tab-switch scroll
 *  reset; the rendered JSX just has to attach `tabScrollRef` to the
 *  scrollable container. */
export function useAskUserQuestionsForm({
  sessionId,
  onAppear,
}: AskUserQuestionsFormArgs): AskUserQuestionsForm {
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

  const handleSubmit = useCallback(() => {
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

  const question = pending?.questions[safeTab] ?? null;

  return {
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
    activeTab,
    setActiveTab,
    canSubmit,
    handleSubmit,
    handleCancel,
    handleTabListKeyDown,
    updateSelection,
    updateOtherText,
    tabScrollRef,
  };
}
