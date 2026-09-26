"use client";

/**
 * Settings → Toast Test
 *
 * Live-preview panel for the bottom-right toast notifications. Lets the
 * user see what each kind looks like with various inputs (description,
 * action button, custom duration, no-icon variant) without firing any
 * backend request. The four default "Show" buttons below the kind
 * selector each demonstrate one real-world-style copy so the user can
 * judge visual weight against common patterns.
 *
 * Differences vs. `InboxTestSection`:
 *  • Purely client-side: no `fetch`, no `/api/...` test endpoint. Toasts
 *    render immediately, so there's no "Last sent" log row.
 *  • The `Stack` button fires 5 toasts in a row to preview the viewport
 *    cap + z-stacking behavior.
 *  • The `Custom message` / `Custom duration` inputs are wired directly
 *    to the corresponding kind button so the user can experiment without
 *    editing code.
 */

import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast, type ToastKind } from "@/components/ui/Toast";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SettingsSection } from "../SettingsSection";
import { PrimaryButton, SecondaryButton, SegmentedControl, TextArea, TextInput } from "../controls";

const KINDS: readonly ToastKind[] = ["success", "error", "info", "warning"];

const KIND_PRESET_MESSAGE: Record<ToastKind, string> = {
  success: "Saved successfully",
  error: "Failed to save",
  info: "New update available",
  warning: "Network is unstable",
};

const KIND_ACCENT: Record<ToastKind, string> = {
  success: "var(--success)",
  error: "var(--error)",
  info: "var(--info)",
  warning: "var(--warning)",
};

const KIND_LABEL_KEY: Record<ToastKind, string> = {
  success: "success",
  error: "error",
  info: "info",
  warning: "warning",
};

const MIN_DURATION_MS = 800;
const MAX_DURATION_MS = 30000;
const DEFAULT_CUSTOM_DURATION = 5000;

export function ToastTestSection() {
  const { t } = useI18n();
  const toast = useToast();

  const [kind, setKind] = useState<ToastKind>("info");
  const [message, setMessage] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [actionLabel, setActionLabel] = useState<string>("");
  const [duration, setDuration] = useState<number>(DEFAULT_CUSTOM_DURATION);

  const messageValid = useMemo(() => message.trim().length > 0, [message]);
  const buildCommonInput = useCallback(
    (overrides?: { message?: string; durationMs?: number }) => {
      const finalMessage = overrides?.message ?? message.trim();
      const input: {
        kind: ToastKind;
        message: string;
        durationMs: number;
        icon?: boolean;
        description?: string;
        action?: { label: string; onClick: () => void };
      } = {
        kind,
        message: finalMessage,
        durationMs: overrides?.durationMs ?? DEFAULT_DURATION(kind, duration),
      };
      const trimmedDesc = description.trim();
      if (trimmedDesc) input.description = trimmedDesc;
      const trimmedAction = actionLabel.trim();
      if (trimmedAction) {
        input.action = {
          label: trimmedAction,
          onClick: () => {
            toast.show({
              kind: "info",
              message: t("Action clicked"),
              durationMs: 2000,
            });
          },
        };
      }
      return input;
    },
    [kind, message, description, actionLabel, duration, t, toast],
  );

  const fireKind = useCallback(() => {
    const input = buildCommonInput({
      message: messageValid ? message.trim() : t(KIND_PRESET_MESSAGE[kind]),
    });
    toast.show(input);
  }, [buildCommonInput, kind, message, messageValid, t, toast]);

  const fireKindWithoutIcon = useCallback(() => {
    const input = buildCommonInput({
      message: messageValid ? message.trim() : t(KIND_PRESET_MESSAGE[kind]),
    });
    input.icon = false;
    toast.show(input);
  }, [buildCommonInput, kind, message, messageValid, t, toast]);

  const fireLongMessage = useCallback(() => {
    const longMsg =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
      "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco.";
    const input = buildCommonInput({
      message: messageValid ? message.trim() + "  " + longMsg : longMsg,
    });
    toast.show(input);
  }, [buildCommonInput, message, messageValid, toast]);

  const fireStack = useCallback(() => {
    const presets: ToastKind[] = ["success", "info", "warning", "error", "info"];
    presets.forEach((k, idx) => {
      // Stagger the dispatches with small delays so the entries don't all
      // collapse onto the same render frame (which would skip the per-card
      // slide-in animation entirely).
      window.setTimeout(() => {
        toast.show({
          kind: k,
          message: `#${idx + 1}  ${t(KIND_PRESET_MESSAGE[k])}`,
          durationMs: 4200,
        });
      }, idx * 180);
    });
  }, [t, toast]);

  return (
    <SettingsSection id="toast-test" topGap>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("Toast Test")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
        {t("Preview each toast kind, custom duration, description, and action button directly without firing any backend request.")}
      </p>

      {/* ── Kind selector ─────────────────────────────────────────── */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px 0" }}>
        {t("Kind")}
      </div>
      <div style={{ marginBottom: 14 }}>
        <SegmentedControl
          value={kind}
          onChange={(value) => setKind(value as ToastKind)}
          ariaLabel={t("Kind")}
          options={KINDS.map((k) => ({
            value: k,
            label: (
              <>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: KIND_ACCENT[k], flexShrink: 0 }} />
                {t(KIND_LABEL_KEY[k])}
              </>
            ),
          }))}
        />
      </div>

      {/* ── Custom message ────────────────────────────────────────── */}
      <FieldLabel>{t("Custom message")}</FieldLabel>
      <TextInput
        value={message}
        onChange={setMessage}
        maxLength={300}
        placeholder={t("Test toast (default copy)")}
      />
      <FieldHint>
        {messageValid
          ? <span style={{ color: "var(--text-dim)" }}>·</span>
          : <span style={{ color: "var(--error)" }}>· {t("Test toast (default copy)")}</span>}
      </FieldHint>

      {/* ── Description ───────────────────────────────────────────── */}
      <FieldLabel>{t("Optional description (multi-line)")}</FieldLabel>
      <TextArea
        value={description}
        onChange={setDescription}
        placeholder="Click anywhere on the toast to dismiss it."
        style={{ minHeight: 56 }}
      />

      {/* ── Action label ──────────────────────────────────────────── */}
      <FieldLabel>{t("Optional action label")}</FieldLabel>
      <TextInput
        value={actionLabel}
        onChange={setActionLabel}
        maxLength={20}
        placeholder="Undo"
      />

      {/* ── Duration ──────────────────────────────────────────────── */}
      <FieldLabel>{t("Custom duration (ms)")}</FieldLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="range"
          min={MIN_DURATION_MS}
          max={MAX_DURATION_MS}
          step={100}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          style={{ flex: 1, accentColor: "var(--accent)" }}
        />
        <NumberStepper
          value={duration}
          onChange={setDuration}
          min={MIN_DURATION_MS}
          max={MAX_DURATION_MS}
          step={100}
          ariaLabel={t("Custom duration (ms)")}
          width={52}
        />
      </div>

      {/* ── Action buttons ────────────────────────────────────────── */}
      <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <PrimaryButton onClick={fireKind} style={{ background: KIND_ACCENT[kind] }}>
          {t("Show this toast")}
        </PrimaryButton>
        <SecondaryButton onClick={fireKindWithoutIcon}>
          {t("Show without icon")}
        </SecondaryButton>
        <SecondaryButton onClick={fireLongMessage}>
          {t("Show with long message and description")}
        </SecondaryButton>
        <SecondaryButton onClick={fireStack}>
          {t("Show 5 stacked toasts")}
        </SecondaryButton>
      </div>
    </SettingsSection>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function DEFAULT_DURATION(kind: ToastKind, custom: number): number {
  // Map the user's chosen kind to a sensible default so the live preview
  // doesn't always render at exactly the user's slider value: errors and
  // warnings linger a bit longer by convention.
  if (kind === "error") return Math.max(custom, 5000);
  if (kind === "warning") return Math.max(custom, 4500);
  return custom;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "12px 0 6px 0" }}>
      {children}
    </div>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>{children}</div>
  );
}