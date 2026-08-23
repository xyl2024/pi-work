"use client";

/**
 * RefreshIconButton — 26×26 square icon button that springs REFRESH → CHECK
 * on click and stays ✓ for 2 seconds before morphing back. Replaces the
 * hand-rolled <button> + <MorphToggleIcon from={REFRESH} to={CHECK} active={done} />
 * + useState/useRef/useEffect dance that was duplicated in SessionSidebar,
 * CollectionPanel, GitPanel, LlmAuditPanel and the RSS views.
 *
 * Visual matches the sidebar Sessions/Explorer refresh buttons (no border,
 * 5px radius, dim → muted hover, green ✓ flash). Call sites that need a
 * bordered look (GitPanel) or a text label (LlmAuditPanel) should layer
 * extra styles via `style={{ border: "1px solid var(--border)", ... }}` —
 * the component intentionally stays minimal so per-panel theming stays
 * possible.
 *
 * Behaviour:
 *   - click fires `onClick` synchronously, then immediately flashes ✓.
 *   - the ✓ auto-clears after 2 s; a fresh click resets the timer.
 *   - when `disabled` is true the cursor flips to `default`, hover effects
 *     are skipped, and clicking does nothing — same as the old inline
 *     implementations.
 *   - the timer ref is cleared on unmount so a flash in flight never tries
 *     to setState on an unmounted node.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MorphToggleIcon } from "./MorphToggleIcon";
import { REFRESH, CHECK } from "@/lib/client/icon-paths";
import { Tooltip } from "./Tooltip";
import { useI18n } from "@/hooks/useI18n";

export interface RefreshIconButtonProps {
  onClick: () => void;
  /** Tooltip / aria-label text. Defaults to translated "Refresh". */
  label?: string;
  /** Disabled = greyed out + no hover effects + click is a no-op. */
  disabled?: boolean;
  /** Forwarded to the outer button. */
  style?: React.CSSProperties;
  /** Forwarded to the outer button (rarely useful — icon button has no text). */
  className?: string;
  /** ms the ✓ stays on screen. Defaults to 2000 (matches sidebar). */
  doneMs?: number;
  /** Forwarded to the inner <svg>. Useful for spin animations while a
   *  fetch is in flight (GitPanel). */
  iconStyle?: React.CSSProperties;
}

export function RefreshIconButton({
  onClick,
  label,
  disabled = false,
  style,
  className,
  doneMs = 2000,
  iconStyle,
}: RefreshIconButtonProps) {
  const { t } = useI18n();
  const tip = label ?? t("Refresh");
  const [done, setDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any in-flight ✓ flash on unmount so the timer can't fire on a
  // torn-down component.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleClick = useCallback(() => {
    if (disabled) return;
    onClick();
    setDone(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDone(false), doneMs);
  }, [disabled, onClick, doneMs]);

  const finalColor = done ? "#4ade80" : "var(--text-dim)";
  const finalBg = done ? "rgba(74,222,128,0.18)" : "none";
  const finalCursor = disabled ? "default" : "pointer";

  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={tip}
        className={className}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, padding: 0,
          background: finalBg, border: "none",
          color: finalColor,
          cursor: finalCursor,
          borderRadius: 5,
          flexShrink: 0,
          transition: "color 0.3s, background 0.3s",
          // Caller-supplied styles win — useful for adding a border, tweaking
          // marginRight, etc. without forking the component.
          ...style,
        }}
        onMouseEnter={(e) => {
          if (disabled || done) return;
          e.currentTarget.style.color = "var(--text-muted)";
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (disabled || done) return;
          e.currentTarget.style.color = "var(--text-dim)";
          e.currentTarget.style.background = "none";
        }}
      >
        <span
          // Wrap the svg in a span so per-icon transforms (e.g. a spin
          // animation while a refresh fetch is in flight) layer cleanly
          // without reaching into MorphToggleIcon's internals.
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            ...iconStyle,
          }}
        >
          <MorphToggleIcon from={REFRESH} to={CHECK} active={done} size={13} strokeWidth={2.5} />
        </span>
      </button>
    </Tooltip>
  );
}