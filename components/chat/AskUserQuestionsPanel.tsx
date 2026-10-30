"use client";

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";
import { isQuestionAnswered } from "@/lib/shared/ask-user-questions-tool-types";
import { useAskUserQuestionsForm } from "./ask-user-questions-panel/useAskUserQuestionsForm";
import { QuestionCard } from "./ask-user-questions-panel/QuestionCard";
import { ASK_PANEL_STYLES, PANEL_HEIGHT_PX } from "./ask-user-questions-panel/constants";

interface Props {
  sessionId: string | null;
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
    sentKind,
    replyOpen,
    replyText,
    setReplyText,
    setActiveTab,
    canSubmit,
    handleSubmit,
    handleCancelClick,
    handleConfirmCancel,
    handleReplyKeyDown,
    handleTabListKeyDown,
    updateSelection,
    updateOtherText,
    tabScrollRef,
  } = form;

  const regionLabel = count === 1
    ? t("Ask User Questions")
    : t("{n} questions pending").replace("{n}", String(count));

  return (
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
          maxWidth: 820,
          margin: "0 auto",
          width: "100%",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 -4px 14px rgba(0, 0, 0, 0.12)",
          display: "flex",
          flexDirection: "column",
          height: PANEL_HEIGHT_PX,
          overflow: "hidden",
        }}
      >
      <style>{ASK_PANEL_STYLES}</style>

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
              const answered = isQuestionAnswered(answers[qIdx]);
              const tabColor = q.required
                ? "var(--accent)"
                : (isActive ? "var(--text)" : "var(--text-muted)");
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
        </div>
      )}

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
            {sentKind === "note" ? t("Note sent") : t("Answers sent")}
          </span>
          <span
            className="askq-fade-up-delayed"
            style={{ fontSize: 11, color: "var(--text-dim)" }}
          >
            {t("The agent is continuing…")}
          </span>
        </div>
      ) : (
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
              />
            )}
          </div>
        </div>
      )}

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
              flexDirection: "column",
              gap: 8,
              padding: "8px 14px 10px 14px",
              borderTop: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            {replyOpen && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleReplyKeyDown}
                  placeholder={t("Add a note for the agent…")}
                  aria-label={t("Note to send when cancelling")}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    minWidth: 0,
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
                <button
                  type="button"
                  onClick={handleConfirmCancel}
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
                    flexShrink: 0,
                  }}
                >
                  {t("Cancel with note")}
                </button>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: count > 1 ? "space-between" : "flex-end",
                alignItems: "center",
                gap: 8,
              }}
            >
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
                onClick={handleCancelClick}
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
          </div>
        </>
      )}
      </div>
    </div>
  );
}
