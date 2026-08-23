"use client";

/**
 * Toast notification overlay — provider, viewport, and per-item card.
 *
 * Design notes
 * ────────────
 *  • Live in the bottom-right corner. Less likely than top-center to
 *    fight header / chat scrolls and easier to ignore when the toast
 *    is purely informational.
 *  • Four kinds: success / error / info / warning. Audio falls back to
 *    `toast_info` for the warning kind because `toast_warning` is not
 *    a sound event id; extending the closed `UI_SOUND_EVENT_IDS` enum
 *    would force migration on every existing config.yaml.
 *  • Visual hierarchy: leading tinted icon disc → bold message →
 *    optional muted description → trailing optional action button.
 *  • Progress bar shows remaining time. Hovering or focusing pauses the
 *    countdown; leaving / blurring resumes it. Clicks dismiss.
 *  • Honors `prefers-reduced-motion`: entrance/exit animations and the
 *    progress bar are disabled — toasts still appear and dismiss.
 *  • Dedupes identical kind+message within a 1s window so a rapid-fire
 *    success doesn't stack 5 copies.
 *  • Caps concurrent toasts at MAX_VISIBLE; older ones dismiss instantly
 *    (no exit animation) to make room.
 *  • API: `show(input)` and `dismiss(id)`. Inputs are backward-compatible
 *    with the original `{ kind, message, durationMs }` shape — adding
 *    fields never breaks callers.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { playUiSoundEvent, setUiSoundsConfig, unlockUiSounds } from "@/lib/client/ui-sounds";
import { useEnsureSettings } from "@/hooks/settingsStore";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  kind?: ToastKind;
  message: string;
  durationMs?: number;
  description?: string;
  action?: ToastAction;
  /** Pass `false` to hide the leading icon disc. Default `true`. */
  icon?: boolean;
}

interface ToastItem extends Required<Pick<ToastInput, "kind" | "durationMs" | "icon">> {
  id: string;
  message: string;
  description?: string;
  action?: ToastAction;
}

interface ToastContextValue {
  /**
   * Show a toast. Returns the toast id so the caller can dismiss it
   * later (e.g. when a follow-up event supersedes the message).
   */
  show: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 3200;
const EXIT_ANIMATION_MS = 220;
const MAX_VISIBLE = 5;
const DEDUPE_WINDOW_MS = 1000;

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `toast-${Date.now()}-${_idCounter}`;
}

// ── Color palettes ───────────────────────────────────────────────────────
// Each kind gets a foreground (icon + progress), a low-tint background fill,
// and a border that's slightly stronger than the fill. Tones intentionally
// avoid using `var(--success)` etc. directly because the toast is overlaid
// on top of opaque panels — slightly darker/saturated values read better on
// both the light and dark themes.
interface KindTone {
  fg: string;
  bg: string;
  border: string;
  iconBg: string;
}

const KIND_TONE: Record<ToastKind, KindTone> = {
  success: {
    fg: "#16a34a",
    bg: "rgba(22,163,74,0.10)",
    border: "rgba(22,163,74,0.32)",
    iconBg: "rgba(22,163,74,0.16)",
  },
  error: {
    fg: "#dc2626",
    bg: "rgba(220,38,38,0.10)",
    border: "rgba(220,38,38,0.32)",
    iconBg: "rgba(220,38,38,0.16)",
  },
  info: {
    fg: "#2563eb",
    bg: "rgba(37,99,235,0.08)",
    border: "rgba(37,99,235,0.28)",
    iconBg: "rgba(37,99,235,0.14)",
  },
  warning: {
    fg: "#d97706",
    bg: "rgba(217,119,6,0.10)",
    border: "rgba(217,119,6,0.32)",
    iconBg: "rgba(217,119,6,0.16)",
  },
};

// ── Provider ────────────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Push the current ui_sounds config into the sound dispatcher. Module-
  // scoped state means a second consumer (e.g. RSS / Inbox hooks) sees the
  // same snapshot the user just toggled in Settings.
  const settings = useEnsureSettings();
  useEffect(() => {
    setUiSoundsConfig(settings?.ui_sounds ?? null);
  }, [settings?.ui_sounds]);

  // Browsers only allow an AudioContext to resume after a user gesture. Unlock
  // once, then later toasts (including async agent results) can be audible.
  useEffect(() => {
    const unlock = () => {
      unlockUiSounds();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Mirror last-shown timestamps so deduplication is robust to rapid callers.
  // The window is short (1s) and the map is bounded; no eviction needed.
  const lastShownRef = useRef<Map<string, number>>(new Map());

  // ── Mutation helpers ────────────────────────────────────────────────
  const removeItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.some((it) => it.id === id) ? prev.filter((it) => it.id !== id) : prev,
    );
    setExitingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  // Kick off the exit animation, then remove from state after the duration
  // matches CSS. The dismiss id is stable so multiple clicks don't restart
  // the animation.
  const dismiss = useCallback(
    (id: string) => {
      setExitingIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setTimeout(() => removeItem(id), EXIT_ANIMATION_MS);
    },
    [removeItem],
  );

  const show = useCallback(
    (input: ToastInput): string => {
      const kind: ToastKind = input.kind ?? "info";
      const message = input.message;
      const durationMs = input.durationMs ?? DEFAULT_DURATION_MS;
      const icon = input.icon !== false; // default true

      if (!message || typeof message !== "string") {
        // Defensive: callers occasionally pass null / undefined. We refuse
        // rather than render "(no text)" as a visible toast — that would
        // just confuse the user.
        return "";
      }

      // Dedup identical kind+message inside the window so a flaky retry
      // loop can't spam the viewport with the same copy five times.
      const dedupKey = `${kind}:${message}`;
      const now = Date.now();
      const last = lastShownRef.current.get(dedupKey) ?? 0;
      if (now - last < DEDUPE_WINDOW_MS) return "";
      lastShownRef.current.set(dedupKey, now);

      // Sound dispatch. The user can silence any of these via Settings →
      // UI Sounds; "warning" intentionally reuses the toast_info event so we
      // don't have to extend the closed sound-event-id enum.
      playUiSoundEvent(
        kind === "success"
          ? "toast_success"
          : kind === "error"
            ? "toast_error"
            : "toast_info",
      );

      const id = nextId();
      const item: ToastItem = {
        id,
        kind,
        message,
        durationMs,
        icon,
        description: input.description,
        action: input.action,
      };

      setItems((prev) => {
        const next = [...prev, item];
        if (next.length > MAX_VISIBLE) {
          // Drop the oldest without an exit animation so the user sees
          // fewer state transitions on a hot path. The kept cap means
          // a burst still renders only MAX_VISIBLE simultaneously.
          return next.slice(next.length - MAX_VISIBLE);
        }
        return next;
      });

      const timer = setTimeout(() => dismiss(id), durationMs);
      timersRef.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} exitingIds={exitingIds} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

// ── Viewport ────────────────────────────────────────────────────────────
// Bottom-right corner: doesn't fight header dropdowns / chat scrolls and
// matches the convention macOS / GitHub / Linear use.
function ToastViewport({
  items,
  exitingIds,
  onDismiss,
}: {
  items: ToastItem[];
  exitingIds: Set<string>;
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="Notifications"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        left: "auto",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 10,
        pointerEvents: "none",
        maxWidth: "min(420px, calc(100vw - 32px))",
      }}
    >
      {items.map((it) => (
        <ToastCard
          key={it.id}
          item={it}
          exiting={exitingIds.has(it.id)}
          onDismiss={() => onDismiss(it.id)}
        />
      ))}
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────
function ToastCard({
  item,
  exiting,
  onDismiss,
}: {
  item: ToastItem;
  exiting: boolean;
  onDismiss: () => void;
}) {
  const tone = KIND_TONE[item.kind];
  // Pause auto-dismiss while the user is hovering or has focus inside the
  // toast. The pause is communicated through a CSS class so the progress
  // bar transitions smoothly instead of jumping when the user mouses over.
  const [paused, setPaused] = useState(false);

  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      aria-live={item.kind === "error" ? "assertive" : "polite"}
      onClick={onDismiss}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss();
        }
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      tabIndex={0}
      className={exiting ? "pi-toast-exit" : "pi-toast-enter"}
      style={{
        pointerEvents: "auto",
        position: "relative",
        width: "100%",
        background: "var(--bg-panel)",
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        padding: "12px 14px 12px 12px",
        fontSize: 13,
        lineHeight: 1.45,
        color: "var(--text)",
        cursor: "pointer",
        overflow: "hidden",
        // Soft, layered shadow. The first shadow hugs the card; the second
        // lifts it off the page so a glance picks it up even on a busy
        // background.
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10)",
        // Backdrop blur is gated behind the @supports below; unsupported
        // browsers fall back to the opaque panel background.
        backdropFilter: "blur(8px) saturate(140%)",
        WebkitBackdropFilter: "blur(8px) saturate(140%)",
        willChange: "transform, opacity",
      }}
    >
      {/* Tinted kind wash — gives each toast a faint colored bias toward
          its tone so the user can read the kind at a glance, even before
          reading the icon. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: tone.bg,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        {item.icon && <ToastIcon kind={item.kind} tone={tone} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: 0.1,
              color: "var(--text)",
              wordBreak: "break-word",
            }}
          >
            {item.message}
          </div>
          {item.description && (
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                fontWeight: 400,
                color: "var(--text-muted)",
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {item.description}
            </div>
          )}
          {item.action && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                item.action?.onClick();
                onDismiss();
              }}
              style={{
                marginTop: 8,
                background: "transparent",
                border: `1px solid ${tone.fg}`,
                borderRadius: 6,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 600,
                color: tone.fg,
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = tone.fg;
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = tone.fg;
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
        {/* Manual close — small × button. The whole card is also clickable,
            but offering an explicit × is the expected affordance on
            notification cards. */}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          style={{
            flexShrink: 0,
            background: "transparent",
            border: "none",
            padding: 2,
            marginTop: -2,
            marginRight: -4,
            color: "var(--text-dim)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            borderRadius: 4,
            transition: "color 0.15s, background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text)";
            e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-dim)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          ×
        </button>
      </div>

      {/* Progress bar at the bottom. Always rendered; the inner element
          shrinks horizontally instead of moving, so a paused state can
          hold the bar frozen mid-way with a `paused` class flag. The
          duration is unique per toast so they animate independently. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          background: "transparent",
          overflow: "hidden",
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
        }}
      >
        <div
          className={paused ? "pi-toast-progress paused" : "pi-toast-progress"}
          style={{
            height: "100%",
            width: "100%",
            background: tone.fg,
            transformOrigin: "left center",
            animation: `pi-toast-progress ${item.durationMs}ms linear forwards`,
          }}
        />
      </div>
    </div>
  );
}

// ── Icon ────────────────────────────────────────────────────────────────
function ToastIcon({
  kind,
  tone,
}: {
  kind: ToastKind;
  tone: KindTone;
}) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: tone.fg,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { flexShrink: 0 },
  };
  return (
    <div
      aria-hidden
      style={{
        flexShrink: 0,
        width: 26,
        height: 26,
        borderRadius: 8,
        background: tone.iconBg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 1,
      }}
    >
      {kind === "success" && (
        <svg {...common}>
          <path d="M3 8.5l3.2 3.2 6.8-7.2" />
        </svg>
      )}
      {kind === "error" && (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
        </svg>
      )}
      {kind === "info" && (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v4" />
          <circle cx="8" cy="4.75" r="0.6" fill={tone.fg} stroke="none" />
        </svg>
      )}
      {kind === "warning" && (
        <svg {...common}>
          <path d="M8 2.5l6 11H2L8 2.5z" />
          <path d="M8 7v3.2" />
          <circle cx="8" cy="11.7" r="0.55" fill={tone.fg} stroke="none" />
        </svg>
      )}
    </div>
  );
}
