"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { MorphToggleIcon } from "@/components/ui/MorphToggleIcon";
import { COPY, CHECK } from "@/lib/client/icon-paths";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "@/components/ui/ProviderIcon";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useTranslationStream } from "@/hooks/useTranslationStream";
import {
  closeTranslateBubble,
  getTranslateBubbleSnapshot,
  subscribeTranslateBubble,
} from "@/hooks/translateBubbleStore";

const STATE_STORAGE_KEY = "pi-translate-bubble-state";
const BUBBLE_WIDTH = 360;
const BUBBLE_GAP = 8;
const BUBBLE_MARGIN = 8;

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

interface ModelsApiResponse {
  modelList?: ModelInfo[];
  models?: Record<string, string>;
  defaultModel?: { provider: string; modelId: string } | null;
  modelIcons?: Record<string, string>;
}

interface PersistedBubbleState {
  model?: { provider: string; modelId: string };
}

/**
 * Single-instance floating translation bubble shown after the user picks
 * `toChinese` / `toEnglish` from the chat text-selection toolbar.
 *
 * The component is mounted once in ChatWindow alongside the toolbar; it
 * subscribes to the module-level `translateBubbleStore` and only renders
 * when the store says `open: true`. As such, when the bubble is hidden
 * the component's overhead is essentially just the store subscription.
 *
 * Design decisions worth re-reading later:
 *
 * - **Position is snapshotted, not live-tracked.** When the store hands
 *   us an `anchorRect` we compute the viewport position once. As the
 *   user scrolls the chat or moves the cursor elsewhere, the bubble
 *   stays at its original screen position. This matches the agreed
 *   A1+A2 design (visible/persistent + original anchor; otherwise the
 *   bubble would jitter with every selection change).
 *
 * - **Single-shot per-direction, replace-on-new-open.** Re-clicking the
 *   same direction with a different selection restarts the stream
 *   (the store bumps `requestSeq`; we abort + restart). Re-clicking
 *   the *same* direction with the same selection while streaming is
 *   effectively a "retry" because the prior request gets aborted.
 *
 * - **No auto-close on click-outside.** The user might still be reading
 *   the translation; closing on outside-click is more annoying than
 *   helpful here. The bubble is dismissed by explicit X / Esc.
 */
export function TranslateBubble() {
  const { t } = useI18n();
  const toast = useToast();

  // ── store subscription ──────────────────────────────────────────────
  // We pull the snapshot synchronously inside the render and also
  // re-subscribe so any open() call (in this or another effect tick)
  // triggers a fresh render. Latest snapshot lives in a ref so
  // async callbacks (start, etc.) read the *current* one without
  // capturing a stale closure.
  const [, force] = useState(0);
  useEffect(() => subscribeTranslateBubble(() => force((n) => n + 1)), []);
  const snap = getTranslateBubbleSnapshot();

  // ── model state + persistence ───────────────────────────────────────
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null);
  const savedModelRef = useRef<{ provider: string; modelId: string } | null>(null);
  // Gate the first persistence save so the hydration pass doesn't
  // clobber storage with a half-populated state.
  const initializedRef = useRef(false);

  // Restore the user's chosen model on first mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STATE_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as PersistedBubbleState;
      if (data?.model && typeof data.model.provider === "string" && typeof data.model.modelId === "string") {
        savedModelRef.current = { provider: data.model.provider, modelId: data.model.modelId };
      }
    } catch { /* ignore */ }
  }, []);

  // Persist on every model change (skipped on the initial pass).
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    try {
      const payload: PersistedBubbleState = {};
      if (model) payload.model = model;
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* ignore */ }
  }, [model]);

  // ── model fetch ────────────────────────────────────────────────────
  // The bubble used to expose a model picker; the picker has been
  // removed so the bubble only *displays* the active model. We still
  // fetch the catalog to resolve the model's display name + provider
  // icon, and we honour any previously-saved choice so users who
  // configured a model in an earlier session keep that pick. New users
  // fall back to the global default.
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/models");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ModelsApiResponse;
        if (cancelled) return;
        const list = data.modelList ?? [];
        setModelList(list);
        setModelIcons(data.modelIcons ?? {});
        const saved = savedModelRef.current;
        if (saved && list.some((m) => m.provider === saved.provider && m.id === saved.modelId)) {
          setModel(saved);
        } else if (data.defaultModel) {
          setModel(data.defaultModel);
        } else if (list.length > 0) {
          setModel({ provider: list[0].provider, modelId: list[0].id });
        }
      } catch (e) {
        if (!cancelled) toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Translation failed") });
      }
    })();
    return () => { cancelled = true; };
  }, [toast, t]);

  // ── translation stream ──────────────────────────────────────────────
  const { output, isStreaming, error, start, stop } = useTranslationStream();
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  // Watch the store's requestSeq: every increment means "a new request
  // was queued", so we abort any in-flight stream and start fresh with
  // the new text + direction. The store replaces prior state wholesale,
  // so the same selection re-translated simply bumps the seq again.
  const lastSeqRef = useRef(0);
  useEffect(() => {
    if (!snap.open) {
      // Reset bookkeeping; a fresh open will set a new seq.
      lastSeqRef.current = 0;
      return;
    }
    if (snap.requestSeq === lastSeqRef.current) return;
    lastSeqRef.current = snap.requestSeq;
    if (!model) return; // wait for the models fetch to settle (see below)
    start({
      text: snap.sourceText,
      target: snap.direction,
      provider: model.provider,
      modelId: model.modelId,
    });
  }, [snap.open, snap.requestSeq, snap.sourceText, snap.direction, model, start]);

  // When `model` becomes available after the first open, kick the
  // stream (handles the race where the store's open() races with the
  // models fetch). We re-check `lastSeqRef` so this only runs once per
  // seq.
  useEffect(() => {
    if (!snap.open) return;
    if (!model) return;
    if (lastSeqRef.current < snap.requestSeq) {
      lastSeqRef.current = snap.requestSeq;
      start({
        text: snap.sourceText,
        target: snap.direction,
        provider: model.provider,
        modelId: model.modelId,
      });
    }
    // `start` is intentionally omitted — it is stable enough through
    // the hook's stable callbacks; including it would just re-fire on
    // identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, snap.open, snap.requestSeq, snap.sourceText, snap.direction]);

  // Auto-scroll the output panel as the stream fills in.
  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output]);

  // ── position ─────────────────────────────────────────────────────────
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Anchor-based position calculation, run whenever the bubble opens
  // (i.e. snap.open + snap.requestSeq flip). The rect is snapshotted
  // by the toolbar at click time so we don't need to listen to scroll
  // or selection change events here.
  useEffect(() => {
    if (!snap.open || !snap.anchorRect) {
      setPos(null);
      return;
    }
    const el = bubbleRef.current;
    const bw = el?.offsetWidth ?? BUBBLE_WIDTH;
    const bh = el?.offsetHeight ?? 120;
    const vw = document.documentElement.clientWidth;
    const r = snap.anchorRect;
    let left = r.centerX - bw / 2;
    left = Math.max(BUBBLE_MARGIN, Math.min(left, vw - bw - BUBBLE_MARGIN));
    let top = r.top - bh - BUBBLE_GAP;
    if (top < BUBBLE_MARGIN) top = r.top + BUBBLE_GAP + 18; // 18 ≈ line-height
    setPos({ left, top });
  }, [snap.open, snap.anchorRect, snap.requestSeq, output, isStreaming, error]);

  // ── close handlers ──────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    closeTranslateBubble();
  }, []);

  useEscapeKey(snap.open, handleClose);

  // ── copy / stop ─────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.show({ kind: "success", message: t("Copied") });
    } catch {
      toast.show({ kind: "error", message: t("Translation failed") });
    }
  }, [output, toast, t]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  // ── display name for the static model label ─────────────────────────
  const currentName = useMemo(() => {
    if (!model) return null;
    const options = modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    return options.find((o) => o.provider === model.provider && o.modelId === model.modelId)?.name ?? model.modelId;
  }, [model, modelList]);

  if (!snap.open) return null;

  return (
    <div
      ref={bubbleRef}
      role="dialog"
      aria-label={t("Translation")}
      dir="ltr"
      onMouseDown={(e) => {
        // Keep clicks inside the bubble (and its dropdown) from
        // bubbling to document-level listeners that might dismiss
        // the chat's text-selection toolbar. We intentionally do
        // NOT dismiss on click-outside — see component header.
        e.stopPropagation();
        // Don't preventDefault — we still want the Copy / Stop
        // buttons to receive their native focus semantics.
      }}
      style={{
        position: "fixed",
        ...(pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }),
        width: BUBBLE_WIDTH,
        zIndex: 8000,
        display: "flex", flexDirection: "column",
        background: "var(--bg-panel)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 10px 28px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.08)",
        animation: "translate-bubble-in 0.14s ease-out forwards",
        transformOrigin: "bottom center",
        overflow: "hidden",
      } as React.CSSProperties}
    >
      {/* Header: read-only model label on the left, action cluster on the right. */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {/* Static model label. No click handler, no dropdown: the bubble
            inherits its model from the global default (or whatever the
            user previously persisted via this same key). To change
            models, open the right-side TranslatePanel. The cursor is
            `default` so it does not advertise interactivity; the
            surrounding chrome (border, hover) is also softened to
            signal "this is not a button". The full name is exposed
            via a Tooltip in case the label is truncated at narrow
            widths. */}
        <Tooltip content={currentName ?? t("Model")}>
          <div
            role="img"
            aria-label={currentName ?? t("Model")}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 8px", height: 24,
              maxWidth: 200, overflow: "hidden",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              fontSize: 11,
              cursor: "default",
              userSelect: "none",
            }}
          >
            <ProviderIcon
              id={resolveProviderIcon(model?.provider, model?.modelId, modelIcons) ?? ""}
              size={11}
              fallback={<ProviderGearIcon size={10} />}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentName ?? t("Model")}
            </span>
          </div>
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Tooltip content={t("Copy")}>
          <button
            onClick={handleCopy}
            disabled={!output}
            aria-label={t("Copy")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, padding: 0,
              background: "transparent", color: "var(--text-muted)",
              border: "none", borderRadius: 4,
              cursor: !output ? "not-allowed" : "pointer",
              opacity: !output ? 0.5 : 1,
            }}
          >
            <MorphToggleIcon from={COPY} to={CHECK} active={copied} size={11} />
          </button>
        </Tooltip>
        <Tooltip content={isStreaming ? t("Stop") : t("Close")}>
          <button
            onClick={isStreaming ? handleStop : handleClose}
            aria-label={isStreaming ? t("Stop") : t("Close")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, padding: 0,
              background: "transparent", color: "var(--text-muted)",
              border: "none", borderRadius: 4,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {isStreaming ? (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            )}
          </button>
        </Tooltip>
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        data-scroll-wide
        style={{
          padding: "10px 12px",
          minHeight: 64,
          maxHeight: 320,
          overflowY: "auto",
          background: "transparent",
          color: error ? "#ef4444" : "var(--text)",
          fontSize: 13, lineHeight: 1.6,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          fontFamily: "var(--font-mono)",
        }}
      >
        {error ? error : output || (
          // Three-way idle state: model not yet fetched (rare; first
          // translation races with /api/models), streaming with no
          // delta yet, or (defensive) neither.
          !model ? (
            <span style={{ color: "var(--text-dim)" }}>{t("Loading…")}</span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-dim)" }}>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" style={{ animation: "pulse 1.2s infinite" }}>
                <circle cx="5" cy="5" r="3" />
              </svg>
              <span>{t("Translating…")}</span>
            </span>
          )
        )}
      </div>
    </div>
  );
}
