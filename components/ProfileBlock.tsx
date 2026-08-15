"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "./Tooltip";
import { InboxBell } from "./InboxBell";

interface Props {
  onOpenSettings?: () => void;
  onOpenModels?: () => void;
  onOpenSkills?: () => void;
  onOpenPrompts?: () => void;
  onOpenScheduler?: () => void;
  onOpenMcp?: () => void;
  onOpenInbox?: () => void;
  inboxUnread?: number;
  refreshKey?: number;
}

interface ProfileResponse {
  username: string | null;
}

const itemBaseStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 10px",
  background: "none",
  border: "none",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 500,
};

export function ProfileBlock({ onOpenSettings, onOpenModels, onOpenSkills, onOpenPrompts, onOpenScheduler, onOpenMcp, onOpenInbox, inboxUnread, refreshKey }: Props) {
  const { t } = useI18n();
  const [username, setUsername] = useState<string | null>(null);
  const [avatarAttempted, setAvatarAttempted] = useState(0);
  const [avatarOk, setAvatarOk] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Hover-driven open: hovering the avatar (or the popup itself) opens
  // the menu; leaving both triggers a delayed close so the cursor has time
  // to traverse the gap between them. Click still toggles for keyboard /
  // touch users — it's the accessibility fallback, not the primary trigger.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HOVER_CLOSE_DELAY_MS = 250;

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setMenuOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const openMenu = useCallback(() => {
    cancelClose();
    setMenuOpen(true);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) {
          if (!cancelled) setUsername(null);
          return;
        }
        const data = (await res.json()) as ProfileResponse;
        if (!cancelled) setUsername(data.username);
      } catch {
        if (!cancelled) setUsername(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Optimistically try to load the avatar on every refreshKey change.
  // If the server has no avatar (404), the onError handler clears avatarOk.
  useEffect(() => {
    setAvatarAttempted((n) => n + 1);
    setAvatarOk(true);
    setAvatarLoaded(false);
  }, [refreshKey]);

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const avatarSrc = `/api/profile/avatar?k=${encodeURIComponent(`${refreshKey ?? 0}-${avatarAttempted}`)}`;
  const showImg = avatarOk;
  const showPlaceholder = !avatarOk || !avatarLoaded;

  const hasAnyEntry = Boolean(onOpenModels || onOpenSkills || onOpenPrompts || onOpenScheduler || onOpenMcp);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        padding: "8px 10px",
        borderTop: "1px solid var(--border)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-panel)",
        // Always stick to the bottom of the sidebar: when every collapsible
        // section is folded the sections contribute no flex-grow, so this
        // auto margin absorbs the leftover space instead of leaving the row
        // dangling above an empty gap.
        marginTop: "auto",
      }}
    >
      <button
        onClick={() => hasAnyEntry && setMenuOpen((v) => !v)}
        aria-label={t("Open quick menu")}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        disabled={!hasAnyEntry}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          padding: 0,
          background: menuOpen ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 6,
          cursor: hasAnyEntry ? "pointer" : "default",
          opacity: 1,
          transition: "background 0.12s",
          textAlign: "left",
        }}
        onMouseEnter={(e) => {
          if (hasAnyEntry) {
            e.currentTarget.style.background = "var(--bg-hover)";
            openMenu();
          }
        }}
        onMouseLeave={(e) => {
          if (!menuOpen) e.currentTarget.style.background = "none";
          scheduleClose();
        }}
      >
        <div
          style={{
            width: 28, height: 28, flexShrink: 0,
            borderRadius: "50%", overflow: "hidden",
            background: "var(--bg-hover)",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid var(--border)",
          }}
        >
          {showImg && (
            <img
              key={avatarSrc}
              src={avatarSrc}
              alt=""
              onLoad={() => setAvatarLoaded(true)}
              onError={() => { setAvatarOk(false); setAvatarLoaded(false); }}
              style={{
                width: "100%", height: "100%", objectFit: "cover",
                display: avatarLoaded ? "block" : "none",
              }}
            />
          )}
          {showPlaceholder && (
            <svg
              width="15" height="15" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ color: "var(--text-muted)" }}
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
        </div>

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: loading ? "var(--text-dim)" : "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 500,
          }}
        >
          {loading ? "…" : (username ?? t("Guest"))}
        </span>
      </button>

      {onOpenInbox && (
        <InboxBell unread={inboxUnread ?? 0} onClick={onOpenInbox} />
      )}

      {onOpenSettings && (
        <Tooltip content={t("Settings")}>
          <button
            onClick={onOpenSettings}
            aria-label={t("Settings")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, padding: 0, flexShrink: 0,
              background: "none",
              border: "none", borderRadius: 7,
              color: "var(--text-muted)", cursor: "pointer",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Tooltip>
      )}

      {/* Always-mounted menu — `menuOpen` toggles the scale/fade transition
          so both open and close animate (conditional render would snap).
          Width matches the sidebar content column (left/right 10px padding,
          same as the avatar row) so the menu reads as sidebar-width, not a
          stray 160px chip. transform-origin: bottom left makes it visibly
          grow out of the avatar instead of the page center. */}
      {hasAnyEntry && (
        <div
          role="menu"
          aria-hidden={!menuOpen}
          className="profile-quick-menu"
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 10,
            right: 10,
            zIndex: 100,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            transformOrigin: "bottom left",
            transform: menuOpen ? "translateY(0) scale(1)" : "translateY(4px) scale(0.97)",
            opacity: menuOpen ? 1 : 0,
            pointerEvents: menuOpen ? "auto" : "none",
            transition:
              "transform 180ms cubic-bezier(0.32, 0.72, 0, 1), opacity 180ms cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          {onOpenModels && (
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); onOpenModels(); }}
              style={itemBaseStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
              </svg>
              <span>{t("Models")}</span>
            </button>
          )}
          {onOpenSkills && (
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); onOpenSkills(); }}
              style={itemBaseStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              <span>{t("Skills")}</span>
            </button>
          )}
          {onOpenPrompts && (
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); onOpenPrompts(); }}
              style={itemBaseStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M4 19.5V4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 1 4 17.5" />
                <path d="M8 7h8" />
                <path d="M8 11h6" />
              </svg>
              <span>{t("Prompts")}</span>
            </button>
          )}
          {onOpenScheduler && (
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); onOpenScheduler(); }}
              style={itemBaseStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
              <span>{t("Scheduled tasks")}</span>
            </button>
          )}
          {onOpenMcp && (
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); onOpenMcp(); }}
              style={itemBaseStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor" style={{ flexShrink: 0 }} aria-hidden="true">
                <path d="M330.965333 529.685333a85.333333 85.333333 0 0 0 120.682667 120.682667L723.2 378.837333l60.330667 60.330667L512 710.698667A170.666667 170.666667 0 0 1 270.634667 469.333333L542.165333 197.824l60.330667 60.330667-271.530667 271.530666z" />
                <path d="M693.034667 107.306667a170.24 170.24 0 0 1 49.6 131.392 170.666667 170.666667 0 0 1 131.392 290.986666L542.165333 861.546667l89.6 89.6-60.330666 60.373333-149.952-149.973333L813.696 469.333333a85.333333 85.333333 0 0 0-120.682667-120.661333L421.482667 620.16l-60.330667-60.330667 271.530667-271.530666A85.333333 85.333333 0 0 0 512 167.616L119.808 559.829333l-60.352-60.330666L451.669333 107.285333a170.666667 170.666667 0 0 1 241.365334 0z" />
              </svg>
              <span>{t("MCP Servers")}</span>
            </button>
          )}
        </div>
      )}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .profile-quick-menu {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}