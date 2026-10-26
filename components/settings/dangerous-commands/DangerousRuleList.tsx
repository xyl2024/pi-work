"use client";

/**
 * The two rule lists on Settings → Agent → Dangerous commands: one read-only
 * (the platform's built-in floor) and one editable (the user's own rules).
 *
 * The row deliberately lives beside the page rather than inside
 * `components/settings/sections/`: its edit affordance is the row itself (not a
 * bordered form control), and the move / delete actions reuse the shared
 * buttons with dense list sizing. Keeping it beside the page also keeps the
 * section file focused on state and save wiring.
 *
 * A user row is a button: clicking it opens the prefilled editor. Move and
 * delete sit beside it instead of inside it, so the whole row stays one target
 * without nesting buttons. The built-in list passes no `actions`, so it renders
 * the same content without pretending to be editable.
 */

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

/** What the user's rows offer beyond reading: edit, move, delete. */
interface RuleRowActions {
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/**
 * One compact action button. The skin (border, background, disabled state)
 * stays in `controls.tsx`; only the dense list's size is overridden here, so
 * these rows cannot drift from the rest of settings.
 */
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

/**
 * One rule: the name the confirmation dialog shows, the pattern as written
 * (monospace, truncated — a long regex must not widen the modal) and whether it
 * ignores case. Shared by the user's list and the built-in list so the two
 * cannot describe a rule differently.
 *
 * `error` is the draft blocker for this row: the rule that stops Save is marked
 * in place, with the compiler's reason underneath.
 */
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

/** The bordered list wrapper both rule lists use. */
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
