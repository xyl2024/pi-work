"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  buildAskUserQuestionsCancel,
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
} from "@/lib/shared/ask-user-questions-tool-types";
import { AUTO_ADVANCE_MS, AUTO_SUBMIT_MS, SENT_VIEW_MS } from "./constants";

export interface AskUserQuestionsFormArgs {
  sessionId: string | null;
  onAppear?: () => void;
}

export interface AskUserQuestionsForm {
  pending: PendingAskUserQuestions | null;
  safeTab: number;
  count: number;
  question: AskUserQuestion | null;
  answers: AskUserQuestionAnswer[];
  otherTexts: Record<number, string>;
  submitting: boolean;
  submitError: string | null;
  sent: boolean;
  sentKind: "answers" | "note" | null;
  replyOpen: boolean;
  replyText: string;
  setReplyText: (text: string) => void;
  activeTab: number;
  setActiveTab: Dispatch<SetStateAction<number>>;
  canSubmit: boolean;
  handleSubmit: () => void;
  handleCancelClick: () => void;
  handleReplyKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleConfirmCancel: () => void;
  handleTabListKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  updateSelection: (qIdx: number, label: string, checked: boolean, multi: boolean) => void;
  updateOtherText: (qIdx: number, text: string) => void;
  tabScrollRef: RefObject<HTMLDivElement | null>;
}

export function useAskUserQuestionsForm({
  sessionId,
  onAppear,
}: AskUserQuestionsFormArgs): AskUserQuestionsForm {
  const pending = usePendingAskUserQuestions(sessionId);
  const submit = useAskUserQuestionsSubmit();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<AskUserQuestionAnswer[]>([]);
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [activeTab, setActiveTab] = useState(0);
  const [sentKind, setSentKind] = useState<"answers" | "note" | null>(null);
  const sent = sentKind !== null;
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");

  const pendingRef = useRef<PendingAskUserQuestions | null>(null);
  const answersRef = useRef<AskUserQuestionAnswer[]>([]);
  const otherTextsRef = useRef<Record<number, string>>({});
  const submittingRef = useRef(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const count = pending?.questions.length ?? 0;
  const safeTab = Math.min(Math.max(activeTab, 0), Math.max(count - 1, 0));

  const clearStaleSubmitted = useCallback(() => {
    const sub = submittedRef.current;
    if (!sub) return;
    const cur = getPendingAskUserQuestions(sub.sessionId);
    if (cur && cur.toolCallId === sub.toolCallId) {
      clearPendingAskUserQuestions(sub.sessionId);
    }
    submittedRef.current = null;
  }, []);

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
    setSubmitError(null);
    setSentKind(null);
    setReplyOpen(false);
    setReplyText("");
    if (!pending) {
      setAnswers([]);
      setOtherTexts({});
      setActiveTab(0);
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
  }, [pending, clearStaleSubmitted]);

  useEffect(() => {
    if (pending) onAppear?.();
  }, [pending, onAppear]);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
      clearStaleSubmitted();
    };
  }, [clearStaleSubmitted]);

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
          selectedLabels: a.selectedLabels,
          otherText: hasOther
            ? (otherTextsRef.current[i] ?? a.otherText ?? "").trim()
            : null,
        };
      }),
    [],
  );

  const showSent = useCallback(
    (kind: "answers" | "note") => {
      const p = pendingRef.current;
      if (!p || !sessionId) return;
      submittedRef.current = { sessionId, toolCallId: p.toolCallId };
      setSentKind(kind);
      sentTimerRef.current = setTimeout(() => {
        sentTimerRef.current = null;
        clearPendingAskUserQuestions(sessionId);
      }, SENT_VIEW_MS);
    },
    [sessionId],
  );

  const doSubmit = useCallback(
    async (finalAnswers: AskUserQuestionAnswer[]) => {
      const p = pendingRef.current;
      if (!p || !sessionId) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        await submit(sessionId, p.toolCallId, { answers: finalAnswers });
        showSent("answers");
      } catch (e) {
        setSentKind(null);
        setSubmitError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [sessionId, submit, showSent],
  );

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
          labels = [label];
        } else if (checked) {
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
          otherText: hasOther
            ? (otherTextsRef.current[qIdx] ?? current.otherText ?? "")
            : null,
        };
        return next;
      });

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

  const doCancel = useCallback(
    async (note: string) => {
      const p = pendingRef.current;
      if (!p || submittingRef.current || !sessionId) return;
      const trimmed = note.trim();
      setSubmitting(true);
      setSubmitError(null);
      try {
        await submit(sessionId, p.toolCallId, buildAskUserQuestionsCancel(trimmed));
        if (trimmed.length > 0) {
          showSent("note");
        } else {
          clearPendingAskUserQuestions(sessionId);
        }
      } catch (e) {
        setSentKind(null);
        setSubmitError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [sessionId, submit, showSent],
  );

  const handleCancelClick = useCallback(() => {
    if (submittingRef.current) return;
    setSubmitError(null);
    if (replyOpen) {
      void doCancel("");
      return;
    }
    setReplyOpen(true);
  }, [doCancel, replyOpen]);

  const handleConfirmCancel = useCallback(() => {
    void doCancel(replyText);
  }, [doCancel, replyText]);

  const handleReplyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void doCancel(replyText);
      } else if (e.key === "Escape") {
        e.preventDefault();
        void doCancel("");
      }
    },
    [doCancel, replyText],
  );

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
    sentKind,
    replyOpen,
    replyText,
    setReplyText,
    activeTab,
    setActiveTab,
    canSubmit,
    handleSubmit,
    handleCancelClick,
    handleReplyKeyDown,
    handleConfirmCancel,
    handleTabListKeyDown,
    updateSelection,
    updateOtherText,
    tabScrollRef,
  };
}
