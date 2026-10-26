"use client";

/**
 * DangerousRuleEditor — edit one dangerous-command rule in the page's draft.
 *
 * A portal modal, deliberately the same shape as the subagent editor: a rule
 * carries a name, a regex, a case-sensitivity flag and its own inline error, so
 * editing it inside the list would collide with the list's own controls (move /
 * delete).
 *
 * Nothing is written here. The editor only hands a complete rule back to the
 * page, which keeps it in the draft until the page-level Save writes the whole
 * list. That is why the footer says "Add rule" / "Save", not "Save settings".
 *
 * `initial` switches the same form between "new" and "edit": when present the
 * fields start prefilled and the caller replaces that row; when absent a new
 * row is appended. The component is mounted per opening, so `useState` can seed
 * from `initial` without an effect.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { DangerousPatternRule } from "@/lib/shared/config-types";
import { dangerousRulesDraftProblem } from "@/lib/shared/dangerous-commands-draft";
import { Field, PrimaryButton, SecondaryButton, TextInput } from "../controls";
import { dangerousRuleProblemText } from "@/lib/client/dangerous-commands-problem-text";

export function DangerousRuleEditor({
  initial,
  builtinNames,
  takenRules,
  onClose,
  onSubmit,
}: {
  /** The rule being edited; absent when creating a new one. */
  initial?: DangerousPatternRule;
  /** The platform's built-in rule names, which a user rule may not reuse. */
  builtinNames?: readonly string[];
  /**
   * The other rows of the page's draft and their positions. Passed in because
   * the editor owns one row, not the list: a duplicate is caught here — by name
   * and by position — instead of only after the row has been appended.
   */
  takenRules?: readonly { name: string; index: number }[];
  onClose: () => void;
  /** Hand the complete rule to the page's draft (append or replace). */
  onSubmit: (rule: DangerousPatternRule) => void;
}) {
  const { t } = useI18n();
  const editing = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [pattern, setPattern] = useState(initial?.pattern ?? "");
  const [ignoreCase, setIgnoreCase] = useState(initial?.ignoreCase === true);
  // Do not shout "name is required" at an empty form the user just opened;
  // after the first keystroke the inline error is what they need.
  const [touched, setTouched] = useState(false);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalEl(document.body);
  }, []);
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({
    isOpen: portalEl !== null,
    onClose,
    backdropAlpha: 0.4,
  });
  useBodyScrollLock(isVisible);

  // The same gate the page's Save button uses, run on this one row. The timeout
  // is deliberately left out: this form does not own that field.
  const problem = dangerousRulesDraftProblem(
    { rules: [{ uid: "new", name, pattern, ignoreCase }] },
    { builtinNames, takenRules },
  );
  const nameProblem =
    problem !== null &&
    (problem.kind === "empty-name" ||
      problem.kind === "duplicate-name" ||
      problem.kind === "builtin-name");
  const error = problem && touched ? dangerousRuleProblemText(problem, t, t("This rule")) : null;

  const submit = () => {
    if (problem) return;
    onSubmit({ name, pattern, ...(ignoreCase ? { ignoreCase: true } : {}) });
  };

  if (!isVisible || !portalEl) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? t("Edit rule") : t("New rule")}
      style={backdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        style={{
          ...panelStyle,
          width: "min(560px, calc(100vw - 32px))",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
            {editing ? t("Edit rule") : t("New rule")}
          </span>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t("Close")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "none", border: "none", borderRadius: 6, color: "var(--text-dim)", cursor: "pointer" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="20" y2="20" /><line x1="20" y1="4" x2="4" y2="20" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <Field
            label={t("Rule name")}
            hint={t("Shown in the confirmation dialog, and remembered by \"always allow\" for this conversation.")}
          >
            <TextInput
              value={name}
              onChange={(value) => {
                setTouched(true);
                setName(value);
              }}
              placeholder="rm -rf"
              invalid={touched && nameProblem}
            />
          </Field>

          <Field
            label={t("Pattern")}
            hint={t("Compiled as a JavaScript regular expression, exactly as written.")}
          >
            <TextInput
              value={pattern}
              onChange={(value) => {
                setTouched(true);
                setPattern(value);
              }}
              placeholder="\\brm\\b.*-rf"
              mono
              invalid={error !== null}
            />
          </Field>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text)" }}>{t("Ignore case")}</span>
            <ToggleSwitch on={ignoreCase} onChange={setIgnoreCase} label={t("Ignore case")} />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: "var(--error)", lineHeight: 1.5 }}>
              <div>{error.message}</div>
              {error.detail && (
                <div style={{ marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", wordBreak: "break-word" }}>
                  {error.detail}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <SecondaryButton onClick={requestClose}>{t("Cancel")}</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={problem !== null}>
            {editing ? t("Save") : t("Add rule")}
          </PrimaryButton>
        </div>
      </div>
    </div>,
    portalEl,
  );
}
