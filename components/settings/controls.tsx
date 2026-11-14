"use client";

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";
import { IconPicker } from "../ui/IconPicker";
import styles from "./controls.module.css";

export const SETTINGS_RADIUS = 8;

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
      {error && <span role="alert" className={`${styles.fieldMessage} ${styles.fieldError}`}>{error}</span>}
      {hint && <span className={styles.fieldMessage}>{hint}</span>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  id,
  disabled,
  maxLength,
  invalid,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  id?: string;
  disabled?: boolean;
  maxLength?: number;
  invalid?: boolean;
  style?: CSSProperties;
}) {
  return (
    <input
      id={id}
      autoComplete="off"
      data-1p-ignore
      data-lpignore="true"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      className={[styles.input, mono ? styles.mono : "", invalid ? styles.invalid : ""].filter(Boolean).join(" ")}
      style={style}
    />
  );
}

export function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "new-password",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: CSSProperties;
}) {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputId = useId();
  const { t } = useI18n();

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        name={`api-token-${inputId}`}
        readOnly={!editing}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        data-1p-ignore
        data-lpignore="true"
        autoCapitalize="none"
        autoCorrect="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={[styles.input, styles.secret, mono ? styles.mono : ""].filter(Boolean).join(" ")}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <Tooltip content={visible ? t("Hide API key") : t("Show API key")}>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("Hide API key") : t("Show API key")}
          className={styles.revealButton}
        >
          {visible ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
              <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
              <path d="M1 1l22 22" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </Tooltip>
    </div>
  );
}

export function NumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={styles.input} />;
}

export function Select({
  value,
  onChange,
  options,
  required,
  id,
  disabled,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly (string | { value: string; label: string })[];
  required?: boolean;
  id?: string;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const { t } = useI18n();
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={styles.input}
      style={{ color: value ? "var(--text)" : "var(--text-dim)", ...style }}
    >
      {!required && <option value="">— {t("inherit")} / {t("none")} —</option>}
      {options.map((o) => {
        const optionValue = typeof o === "string" ? o : o.value;
        const optionLabel = typeof o === "string" ? o : o.label;
        return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
      })}
    </select>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={styles.checkbox} />
      {label}
    </label>
  );
}

export function GroupedSelect({
  value,
  onChange,
  groups,
  leadingOption,
  disabled,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: readonly { label: string; options: readonly { value: string; label: string }[] }[];
  leadingOption?: { value: string; label: string };
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={styles.input}
      style={style}
    >
      {leadingOption && <option value={leadingOption.value}>{leadingOption.label}</option>}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className={styles.sectionTitle}>{children}</div>;
}

export function IconField({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { t } = useI18n();
  return (
    <Field label={t("Icon")} hint={t("Icon source hint")}>
      <IconPicker
        value={value}
        onChange={onChange}
        autoLabel={t("Inherit / automatic")}
        dialogLabel={t("Choose icon")}
      />
    </Field>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  type?: "button" | "submit";
  style?: CSSProperties;
}

export function PrimaryButton({ children, onClick, disabled, title, ariaLabel, type = "button", style }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`${styles.button} ${styles.primary}`}
      style={style}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, title, ariaLabel, type = "button", style }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`${styles.button} ${styles.secondary}`}
      style={style}
    >
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  onClick,
  disabled,
  title,
  ariaLabel,
  type = "button",
  style,
  size = "default",
}: ButtonProps & { size?: "default" | "compact" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={[styles.button, styles.danger, size === "compact" ? styles.compact : ""].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
    </button>
  );
}

export function SegmentedControl({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: ReactNode; title?: string }[];
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={[styles.segment, active ? styles.segmentActive : ""].filter(Boolean).join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  disabled,
  mono,
  invalid,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  invalid?: boolean;
  style?: CSSProperties;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      className={[styles.input, styles.textarea, mono ? styles.mono : "", invalid ? styles.invalid : ""].filter(Boolean).join(" ")}
      style={style}
    />
  );
}
