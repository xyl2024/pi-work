"use client";

import { useMemo } from "react";
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
}

export function QuestionCard({
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
  const isMulti = !!question.multiSelect;

  return (
    <div
      style={{
        padding: "4px 0 10px 0",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Question text. The header chip is already shown on the tab above
          (multi-question panels), so it's not repeated here. */}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
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
          gap: 6,
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
            <div key={inputId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                htmlFor={inputId}
                className={`askq-opt${checked ? " askq-checked" : ""}`}
              >
                <input
                  id={inputId}
                  className="askq-input"
                  type={isMulti ? "checkbox" : "radio"}
                  name={`ask-q-${question.header}`}
                  checked={checked}
                  onChange={(e) => onToggle(opt.label, e.target.checked)}
                  tabIndex={0}
                />
                {/* Drawn control: circle for radio, rounded square for
                    checkbox; checked fills with accent and a stroke-drawn
                    white check appears. All visual states (rest / hover /
                    checked / press / focus) live in ASK_PANEL_STYLES. */}
                <span
                  aria-hidden
                  className={`askq-marker ${isMulti ? "askq-checkbox" : "askq-radio"}`}
                >
                  <svg
                    className="askq-checkbox-check"
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4.8 10.5 L8.4 14.2 L15.2 6" />
                  </svg>
                </span>
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--text)",
                      fontWeight: checked ? 600 : 500,
                    }}
                  >
                    {isOther ? t("Other") : opt.label}
                  </span>
                  {opt.description && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        lineHeight: 1.45,
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
                    marginLeft: 38,
                    padding: "6px 10px",
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--text)",
                    outline: "none",
                    transition: "border-color 0.12s ease",
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
