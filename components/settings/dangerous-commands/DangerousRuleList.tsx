"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { DangerousPatternRule } from "@/lib/shared/config-types";
import { DangerButton, SecondaryButton, SETTINGS_RADIUS } from "../controls";

const ROW_STYLE = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  padding: "7px 10px",
} as const;

interface RuleRowActions {
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function RowAction({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const Button = danger ? DangerButton : SecondaryButton;
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      title={label}
      ariaLabel={label}
      style={{
        flexShrink: 0,
        height: 24,
        minWidth: 26,
        padding: "2px 6px",
        fontSize: 11,
        ...(danger ? { color: "var(--error)" } : {}),
      }}
    >
      {children}
    </Button>
  );
}

export function RuleRow({
  rule,
  first,
  error,
  actions,
}: {
  rule: DangerousPatternRule;
  first: boolean;
  error?: { message: string; detail?: string } | null;
  actions?: RuleRowActions;
}) {
  const { t } = useI18n();

  const content = (
    <>
      <span
        title={rule.name}
        style={{
          flexShrink: 0,
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 12,
          color: "var(--text)",
        }}
      >
        {rule.name}
      </span>
      <code
        title={rule.pattern}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        {rule.pattern}
      </code>
      <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)" }}>
        {rule.ignoreCase ? t("Ignore case") : t("Case-sensitive")}
      </span>
    </>
  );

  const contentStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
    textAlign: "left",
  } as const;

  return (
    <div
      style={{
        borderTop: first ? "none" : "1px solid var(--border)",
        background: error ? "color-mix(in srgb, var(--error) 7%, transparent)" : undefined,
      }}
    >
      <div style={ROW_STYLE}>
        {actions ? (
          <button
            type="button"
            onClick={actions.onEdit}
            title={t("Edit rule")}
            style={{
              ...contentStyle,
              padding: 0,
              border: "none",
              background: "none",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            {content}
          </button>
        ) : (
          <div style={contentStyle}>{content}</div>
        )}

        {actions && (
          <>
            <RowAction
              label={`${t("Move up")} ${rule.name}`}
              onClick={actions.onMoveUp}
              disabled={!actions.canMoveUp}
            >
              ↑
            </RowAction>
            <RowAction
              label={`${t("Move down")} ${rule.name}`}
              onClick={actions.onMoveDown}
              disabled={!actions.canMoveDown}
            >
              ↓
            </RowAction>
            <RowAction
              label={`${t("Delete rule")} ${rule.name}`}
              onClick={actions.onDelete}
              danger
            >
              {t("Delete")}
            </RowAction>
          </>
        )}
      </div>
      {error && (
        <div style={{ padding: "0 10px 7px 10px", fontSize: 11, color: "var(--error)", lineHeight: 1.5 }}>
          <div>{error.message}</div>
          {error.detail && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dim)",
                wordBreak: "break-word",
              }}
            >
              {error.detail}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RuleList({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: SETTINGS_RADIUS,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {children}
    </div>
  );
}
