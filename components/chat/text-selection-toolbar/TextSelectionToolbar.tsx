"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import type { TextSelectionState } from "@/hooks/useTextSelection";
import { openTranslateBubble } from "@/hooks/translateBubbleStore";
import { copyText } from "@/lib/client/clipboard";

/** Small icon — keeps the toolbar footprint compact so it doesn't
 *  dominate the user's selection. */
const Icon = {
  Copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Translate: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h8" />
      <path d="M9 3v2" />
      <path d="M5 5c0 4 3 7 6 9" />
      <path d="M11 5c0 3-2 6-6 8" />
      <path d="M14 21l5-12 5 12" />
      <path d="M15.5 17h7" />
    </svg>
  ),
  Quote: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21c0-3 2-6 6-7" />
      <path d="M9 11a4 4 0 1 0-4-4" />
      <path d="M15 21c0-3 2-6 6-7" />
      <path d="M21 11a4 4 0 1 0-4-4" />
    </svg>
  ),
};

/** Toolbar actions. `translate` renders the to-zh / to-en pair, `quote`
 *  the blockquote button, `copy` the copy button. */
export type TextSelectionAction = "translate" | "quote" | "copy";

const DEFAULT_ACTIONS: TextSelectionAction[] = ["translate", "quote", "copy"];

interface Props {
  state: TextSelectionState;
  /** Called with the selected text when the user clicks Quote. The
   *  parent is responsible for inserting it into the chat input as a
   *  markdown blockquote. Required only when `actions` includes `quote`. */
  onQuote?: (text: string) => void;
  /** Dismiss the toolbar after an action completes. The toolbar calls
   *  this on every button press so a successful Quote / Copy /
   *  Translate gesture doesn't leave the toolbar hovering over the
   *  chat after the user's intent is already fulfilled. */
  onHide: () => void;
  /** Which actions to render. Defaults to all of them — non-chat hosts
   *  (e.g. the skills detail page) pass `["translate", "copy"]` to drop
   *  the chat-specific Quote button. */
  actions?: TextSelectionAction[];
}

/**
 * Floating toolbar shown above a text selection in the chat window.
 *
 * Visibility / timing / scroll-hide are owned by `useTextSelection`;
 * this component is a pure renderer that positions itself in viewport
 * space using the `rect` provided by the hook. The toolbar itself is
 * a single fixed-position element; the only state it owns is the
 * transient "Copied!" affordance on the Copy button.
 *
 * Translation gestures are no longer coupled to the right-side
 * TranslatePanel: clicking `toChinese` / `toEnglish` publishes to the
 * module-level `translateBubbleStore`, and a single TranslateBubble
 * instance (mounted at the chat root) renders the floating
 * popover. This keeps the toolbar a pure intent-publisher.
 */
export function TextSelectionToolbar({ state, onQuote, onHide, actions = DEFAULT_ACTIONS }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const ref = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Toolbar dimensions are needed to clamp into the viewport. Read
  // them from the rendered element after every visibility flip; the
  // toolbar is small (4 buttons) so the cost is negligible.
  useEffect(() => {
    if (!state.visible) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el || !state.rect) return;
    const vw = document.documentElement.clientWidth;
    const margin = 8;
    const gap = 8; // gap between toolbar and selection top edge
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    // Centre on the selection's topmost row, then clamp horizontally
    // so a selection near the right edge doesn't push the toolbar off
    // the screen.
    let left = state.rect.centerX - tw / 2;
    left = Math.max(margin, Math.min(left, vw - tw - margin));
    // Default: above the selection. If there's not enough room
    // (within 8px of the viewport top), flip below.
    let top = state.rect.top - th - gap;
    if (top < margin) top = state.rect.top + gap + 18; // 18 ≈ line-height
    setPos({ left, top });
  }, [state]);

  const handleCopy = useCallback(async () => {
    if (!state.text) return;
    try {
      await copyText(state.text);
      setCopied(true);
      toast.show({ kind: "success", message: t("Copied") });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API rejects on non-secure contexts; the user can
      // still rely on the browser's native copy via the selection
      // itself, so we don't surface a hard error.
      toast.show({ kind: "error", message: t("Translation failed") });
    }
    onHide();
  }, [state.text, toast, t, onHide]);

  // Both translation gestures share the same flow: open the bubble
  // for the chosen direction, then hide the toolbar so the bubble
  // has the visual focus. `openTranslateBubble` is a no-op if
  // `state.text` is empty, so the empty-selection case is safe.
  const openBubble = useCallback((direction: "zh" | "en") => {
    if (!state.text || !state.rect) return;
    openTranslateBubble(direction, state.text, {
      top: state.rect.top,
      centerX: state.rect.centerX,
      width: state.rect.width,
    });
    // Dismiss the toolbar after opening the bubble so the bubble has the
    // visual focus — same as Copy / Quote. Otherwise the toolbar stays on
    // top (it renders after the bubble in some trees, e.g. the right
    // panel) and floats over the translation.
    onHide();
  }, [state.text, state.rect, onHide]);

  const handleQuote = useCallback(() => {
    if (!state.text || !onQuote) return;
    onQuote(state.text);
    onHide();
  }, [state.text, onQuote, onHide]);

  // Memo the button list so the same JSX isn't re-created on every
  // render — the buttons themselves are stable across selections
  // apart from their onClick targets.
  const buttons = useMemo(() => {
    const list: {
      key: string;
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
    }[] = [];
    if (actions.includes("translate")) {
      list.push(
        { key: "to-zh", label: t("toChinese"), icon: Icon.Translate, onClick: () => openBubble("zh") },
        { key: "to-en", label: t("toEnglish"), icon: Icon.Translate, onClick: () => openBubble("en") },
      );
    }
    if (actions.includes("quote") && onQuote) {
      list.push({ key: "quote", label: t("Quote"), icon: Icon.Quote, onClick: handleQuote });
    }
    if (actions.includes("copy")) {
      list.push({ key: "copy", label: copied ? t("Copied") : t("Copy"), icon: Icon.Copy, onClick: handleCopy });
    }
    return list;
  }, [actions, t, openBubble, onQuote, handleQuote, handleCopy, copied]);

  if (!state.visible) return null;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t("Text actions")}
      // pointer-events: the toolbar must remain clickable even when it
      // floats over the chat's content. The container's mousedown
      // listener hides the toolbar on outside clicks; since this
      // element lives at the document root, every click on it is an
      // "outside" click and would dismiss the toolbar *before* the
      // button's onClick fires. We stop propagation in onMouseDown
      // to keep the toolbar alive while the user is interacting with
      // it. The same trick is used by every anchored popover in the
      // codebase.
      style={{
        position: "fixed",
        ...(pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }),
        zIndex: 8000,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 4,
        background: "var(--bg-panel)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)",
        // Subtle scale-in to confirm the toolbar popping up is a
        // direct response to the selection (rather than a stale
        // remnant from a previous render). The `forwards` fill keeps
        // the final scale locked.
        animation: "selection-toolbar-in 0.12s ease-out forwards",
        transformOrigin: "bottom center",
      } as React.CSSProperties}
      onMouseDown={(e) => {
        // Keep the toolbar alive while the user clicks its own
        // buttons. Without this, the document-level mousedown
        // listener in useTextSelection would call hide() and the
        // button onClick would still fire on the same event, but the
        // toolbar would visually disappear for one frame. Stopping
        // here is the cleanest fix.
        e.stopPropagation();
        // Prevent the chat textarea / inputs below from receiving
        // this event (which would otherwise steal focus and drop
        // the selection on some browsers).
        e.preventDefault();
      }}
    >
      {buttons.map((b) => (
        <button
          key={b.key}
          onClick={b.onClick}
          aria-label={b.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 8px",
            background: "transparent",
            color: "var(--text)",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            lineHeight: 1,
            // Hover/active handled inline because the existing
            // --bg-hover variable already covers the project's
            // hover style; CSS-in-JS keeps the file self-contained.
            transition: "background-color 0.12s",
          } as React.CSSProperties}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          {b.icon}
          <span>{b.label}</span>
        </button>
      ))}
    </div>
  );
}
