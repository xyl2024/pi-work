"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import type { TextSelectionState } from "@/hooks/useTextSelection";
import { openTranslateBubble } from "@/hooks/translateBubbleStore";
import { copyText } from "@/lib/client/clipboard";

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

export type TextSelectionAction = "translate" | "quote" | "copy";

const DEFAULT_ACTIONS: TextSelectionAction[] = ["translate", "quote", "copy"];

interface Props {
  state: TextSelectionState;
  onQuote?: (text: string) => void;
  onHide: () => void;
  actions?: TextSelectionAction[];
}

export function TextSelectionToolbar({ state, onQuote, onHide, actions = DEFAULT_ACTIONS }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const ref = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!state.visible) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el || !state.rect) return;
    const vw = document.documentElement.clientWidth;
    const margin = 8;
    const gap = 8;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = state.rect.centerX - tw / 2;
    left = Math.max(margin, Math.min(left, vw - tw - margin));
    let top = state.rect.top - th - gap;
    if (top < margin) top = state.rect.top + gap + 18;
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
      toast.show({ kind: "error", message: t("Translation failed") });
    }
    onHide();
  }, [state.text, toast, t, onHide]);

  const openBubble = useCallback((direction: "zh" | "en") => {
    if (!state.text || !state.rect) return;
    openTranslateBubble(direction, state.text, {
      top: state.rect.top,
      centerX: state.rect.centerX,
      width: state.rect.width,
    });
    onHide();
  }, [state.text, state.rect, onHide]);

  const handleQuote = useCallback(() => {
    if (!state.text || !onQuote) return;
    onQuote(state.text);
    onHide();
  }, [state.text, onQuote, onHide]);

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
        animation: "selection-toolbar-in 0.12s ease-out forwards",
        transformOrigin: "bottom center",
      } as React.CSSProperties}
      onMouseDown={(e) => {
        e.stopPropagation();
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
