"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";
import { ProviderIcon, ProviderGearIcon, hasProviderIcon, PROVIDER_ICON_IDS } from "../ui/ProviderIcon";

/**
 * The settings control skin — one definition every settings section (and the
 * three resource modals, via the re-export shim in `models-config/form-fields`)
 * shares. Changing the look of a control is a change to this file, not to
 * thirteen section files.
 *
 * The skin is the one that appeared most often and is most consistent with the
 * rest of the settings page: radius 6, control font size 13, control height 32.
 * There is deliberately no second skin kept alongside it.
 */

export const SETTINGS_RADIUS = 6;
export const SETTINGS_CONTROL_FONT_SIZE = 13;
export const SETTINGS_CONTROL_HEIGHT = 32;
export const SETTINGS_CONTROL_PADDING = "6px 10px";

export const inputStyle: CSSProperties = {
  padding: SETTINGS_CONTROL_PADDING,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: SETTINGS_RADIUS,
  color: "var(--text)",
  fontSize: SETTINGS_CONTROL_FONT_SIZE,
  height: SETTINGS_CONTROL_HEIGHT,
  width: "100%",
  boxSizing: "border-box",
};

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{hint}</span>}
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  id?: string;
  disabled?: boolean;
  maxLength?: number;
  invalid?: boolean;
}) {
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      style={{ ...inputStyle, borderColor: invalid ? "var(--error)" : "var(--border)", fontFamily: mono ? "var(--font-mono)" : "inherit" }}
    />
  );
}

export function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
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
  const { t } = useI18n();

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 34, fontFamily: mono ? "var(--font-mono)" : "inherit" }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <Tooltip content={visible ? t("Hide API key") : t("Show API key")}>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("Hide API key") : t("Show API key")}
          style={{
            position: "absolute",
            right: 5,
            top: "50%",
            transform: "translateY(-50%)",
            width: 24,
            height: 24,
            padding: 0,
            border: "none",
            background: "transparent",
            color: "var(--text-dim)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
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
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />;
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
      style={{ ...inputStyle, color: value ? "var(--text)" : "var(--text-dim)", ...style }}
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
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

/** A select with `<optgroup>` sections and an optional leading option. */
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
      style={{ ...inputStyle, ...style }}
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
  return <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{children}</div>;
}

export function IconField({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { t } = useI18n();
  return (
    <Field label={t("Icon")}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: SETTINGS_RADIUS, background: "var(--bg-hover)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {value && hasProviderIcon(value)
            ? <ProviderIcon id={value} size={16} />
            : <ProviderGearIcon size={14} />}
        </div>
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          style={{ ...inputStyle, flex: 1 }}
        >
          <option value="">— {t("none")} / {t("inherit")} —</option>
          {PROVIDER_ICON_IDS.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>
      <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("Icon source hint")}</span>
    </Field>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  type?: "button" | "submit";
  style?: CSSProperties;
}

const BUTTON_BASE: CSSProperties = {
  height: SETTINGS_CONTROL_HEIGHT,
  padding: "6px 12px",
  borderRadius: SETTINGS_RADIUS,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap",
  transition: "background-color 0.15s, border-color 0.15s, color 0.15s",
};

export function PrimaryButton({ children, onClick, disabled, title, ariaLabel, type = "button", style }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={{
        ...BUTTON_BASE,
        background: "var(--accent)",
        border: "none",
        color: "#fff",
        fontSize: SETTINGS_CONTROL_FONT_SIZE,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
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
      style={{
        ...BUTTON_BASE,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        color: "var(--text)",
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; } }}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text)"; } }}
    >
      {children}
    </button>
  );
}

export function DangerButton({ children, onClick, disabled, title, ariaLabel, type = "button", style }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={{
        ...BUTTON_BASE,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        color: "var(--text-muted)",
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = "var(--error)"; e.currentTarget.style.color = "var(--error)"; } }}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; } }}
    >
      {children}
    </button>
  );
}

// ── Segmented control ───────────────────────────────────────────────────

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
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "flex", gap: 6 }}>
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
            style={{
              flex: 1,
              height: 36,
              background: active ? "var(--accent)" : "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: SETTINGS_RADIUS,
              color: active ? "#fff" : "var(--text)",
              fontSize: SETTINGS_CONTROL_FONT_SIZE,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Textarea ────────────────────────────────────────────────────────────

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
      style={{
        ...inputStyle,
        height: "auto",
        minHeight: 80,
        padding: "8px 10px",
        resize: "vertical",
        lineHeight: 1.5,
        borderColor: invalid ? "var(--error)" : "var(--border)",
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        ...style,
      }}
    />
  );
}