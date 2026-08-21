"use client";

import { useMemo, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  ASK_USER_QUESTIONS_OTHER_LABEL,
  isOtherOptionLabel,
  type AskUserQuestion,
  type AskUserQuestionAnswer,
} from "@/lib/shared/ask-user-questions-tool-types";

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

export function QuestionCard({
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
