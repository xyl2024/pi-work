"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { Tooltip } from "../ui/Tooltip";
import { SmartImage } from "../ui/SmartImage";
import { SettingsIcon } from "../ui/animated-icons";
import { MorphToggleIcon } from "../ui/MorphToggleIcon";
import { SUN, MOON } from "@/lib/client/icon-paths";

interface Props {
  onOpenSettings?: () => void;
  refreshKey?: number;
  onLogout?: () => void;
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

export function ProfileBlock({ onOpenSettings, refreshKey, onLogout }: Props) {
  const { t, locale, toggleLocale } = useI18n();
  const { isDark, setPreset } = useTheme();
  const [username, setUsername] = useState<string | null>(null);
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [avatarAttempted, setAvatarAttempted] = useState(0);
  const [avatarOk, setAvatarOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session/status")
      .then((res) => res.json() as Promise<{ loginEnabled?: boolean }>)
      .then((data) => { if (!cancelled) setLoginEnabled(data.loginEnabled === true); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

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

  const handleToggleTheme = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPreset(isDark ? "light" : "dark", {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [isDark, setPreset]);

  const nextLocaleLabel = `${t("Switch language")} → ${t(locale === "zh" ? "English" : "Chinese")}`;

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

  useEffect(() => {
    setAvatarAttempted((n) => n + 1);
    setAvatarOk(true);
  }, [refreshKey]);

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
  const showPlaceholder = !avatarOk;

  const hasAnyEntry = loginEnabled && Boolean(onLogout);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        padding: "8px 10px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-panel)",
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
            <SmartImage
              key={avatarSrc}
              src={avatarSrc}
              alt=""
              onError={() => setAvatarOk(false)}
              loaderSize={14}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
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

      <Tooltip content={nextLocaleLabel}>
        <button
          onClick={toggleLocale}
          aria-label={nextLocaleLabel}
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
          <span
            key={locale}
            aria-hidden="true"
            style={{
              display: "inline-block",
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1,
              animation: "lang-swap-in 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          >
            {locale === "zh" ? "中" : "英"}
          </span>
        </button>
      </Tooltip>

      <Tooltip content={t("Switch theme")}>
        <button
          onClick={handleToggleTheme}
          aria-label={t("Switch theme")}
          aria-pressed={isDark}
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
          <MorphToggleIcon from={SUN} to={MOON} active={isDark} size={15} strokeWidth={2} />
        </button>
      </Tooltip>

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
            <SettingsIcon size={15} />
          </button>
        </Tooltip>
      )}

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
            background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--border)",
            borderRadius: 10,
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
          {onLogout && (
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); onLogout(); }}
              style={itemBaseStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>{t("Log out")}</span>
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