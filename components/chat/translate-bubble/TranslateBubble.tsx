"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { MorphToggleIcon } from "@/components/ui/MorphToggleIcon";
import { COPY, CHECK } from "@/lib/client/icon-paths";
import { copyText } from "@/lib/client/clipboard";
import { useModelIconPreferencesSync } from "@/lib/client/useModelIconPreferencesSync";
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
  modelIconPreferences?: Record<string, string>;
}

interface PersistedBubbleState {
  model?: { provider: string; modelId: string };
}

export function TranslateBubble() {
  const { t } = useI18n();
  const toast = useToast();

  const [, force] = useState(0);
  useEffect(() => subscribeTranslateBubble(() => force((n) => n + 1)), []);
  const snap = getTranslateBubbleSnapshot();

  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  const [modelIconPreferences, setModelIconPreferences] = useState<Record<string, string>>({});
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null);
  const savedModelRef = useRef<{ provider: string; modelId: string } | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STATE_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as PersistedBubbleState;
      if (data?.model && typeof data.model.provider === "string" && typeof data.model.modelId === "string") {
        savedModelRef.current = { provider: data.model.provider, modelId: data.model.modelId };
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    try {
      const payload: PersistedBubbleState = {};
      if (model) payload.model = model;
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [model]);

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
        setModelIconPreferences(data.modelIconPreferences ?? {});
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

  useModelIconPreferencesSync(setModelIconPreferences);

  const { output, isStreaming, error, start, stop } = useTranslationStream();
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const lastSeqRef = useRef(0);
  useEffect(() => {
    if (!snap.open) {
      lastSeqRef.current = 0;
      return;
    }
    if (snap.requestSeq === lastSeqRef.current) return;
    lastSeqRef.current = snap.requestSeq;
    if (!model) return;
    start({
      text: snap.sourceText,
      target: snap.direction,
      provider: model.provider,
      modelId: model.modelId,
    });
  }, [snap.open, snap.requestSeq, snap.sourceText, snap.direction, model, start]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, snap.open, snap.requestSeq, snap.sourceText, snap.direction]);

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output]);

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

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
    if (top < BUBBLE_MARGIN) top = r.top + BUBBLE_GAP + 18;
    setPos({ left, top });
  }, [snap.open, snap.anchorRect, snap.requestSeq, output, isStreaming, error]);

  const handleClose = useCallback(() => {
    closeTranslateBubble();
  }, []);

  useEscapeKey(snap.open, handleClose);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    try {
      await copyText(output);
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
        e.stopPropagation();
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
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          position: "relative",
        }}
      >
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
              id={resolveProviderIcon(model?.provider, model?.modelId, modelIcons, modelIconPreferences) ?? ""}
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
