"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { MorphToggleIcon } from "../ui/MorphToggleIcon";
import { COPY, CHECK } from "@/lib/client/icon-paths";
import { AnimatedPopover } from "../ui/AnimatedPopover";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "../ui/ProviderIcon";
import {
  DEFAULT_TARGET_LANGUAGE,
  TRANSLATE_PROMPTS,
  isLanguageCode,
  type LanguageCode,
} from "@/lib/shared/translate";
import { useTranslationStream } from "@/hooks/useTranslationStream";

const STATE_STORAGE_KEY = "pi-translate-state";

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface ModelsApiResponse {
  modelList?: ModelInfo[];
  models?: Record<string, string>;
  defaultModel?: { provider: string; modelId: string } | null;
  modelIcons?: Record<string, string>;
}

interface PersistedState {
  input?: string;
  output?: string;
  model?: { provider: string; modelId: string };
  target?: LanguageCode;
}

export function TranslatePanel() {
  const { t } = useI18n();
  const toast = useToast();

  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [target, setTarget] = useState<LanguageCode>(DEFAULT_TARGET_LANGUAGE);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [input, setInput] = useState("");
  const { output, isStreaming, error, start, stop, setOutput } = useTranslationStream();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  // One-shot auto-translate request pushed in from outside the panel
  // (e.g. the chat text-selection toolbar's Translate action, which
  // sets `target: "zh"`). When set, an effect below fires a
  // translation as soon as `model` is loaded and `input` matches the
  // pushed text (so the user changing the textarea in the meantime
  // cancels the auto-fire). Cleared once consumed so it doesn't
  // re-trigger on later state changes.
  const autoFireRef = useRef<{ text: string; target: LanguageCode } | null>(null);

  // Persistence refs (not in state — changes here should not trigger renders).
  // `savedModelRef` holds the model the user previously selected; the models
  // fetch effect consults it once the model list is available so we restore
  // the same model instead of falling back to the default.
  const savedModelRef = useRef<{ provider: string; modelId: string } | null>(null);
  // `initializedRef` gates the save effect so the very first run (with
  // pre-restore default values) doesn't clobber the data we're about to
  // rehydrate.
  const initializedRef = useRef(false);

  // Restore input/output/model/target from localStorage so switching tabs (or
  // closing/reopening the translate tab) preserves the last translation.
  // Translation now fires only when the user clicks the Translate button, so
  // rehydrating these values doesn't kick off a request on its own.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STATE_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as PersistedState;
      if (typeof data?.input === "string") setInput(data.input);
      if (typeof data?.output === "string") setOutput(data.output);
      if (data?.model && typeof data.model.provider === "string" && typeof data.model.modelId === "string") {
        savedModelRef.current = { provider: data.model.provider, modelId: data.model.modelId };
      }
      if (isLanguageCode(data?.target)) {
        setTarget(data.target);
      }
    } catch { /* malformed JSON or localStorage unavailable — ignore */ }
  }, [setOutput]);

  // Persist input/output/model/target to localStorage on every change. The
  // first run is skipped so the initial empty state doesn't overwrite the
  // data we are about to rehydrate above.
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    try {
      const payload: PersistedState = { input, output, target };
      if (model) payload.model = model;
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota exceeded or localStorage unavailable — ignore */ }
  }, [input, output, model, target]);

  // Load models on mount, pre-select the default.
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
        // Prefer the model the user had selected last session; fall back to
        // the default model, then to the first entry in the list.
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

  // Close the model dropdown on outside click.
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (dropdownRef.current?.contains(tgt)) return;
      if (panelRef.current?.contains(tgt)) return;
      setModelDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelDropdownOpen]);

  // No auto-resize needed: the input wrapper is `flex: 1`, so the textarea
  // fills half the panel vertically (matching the output area 1:1) and
  // scrolls internally when content overflows.

  // Auto-scroll output to the bottom while streaming.
  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output]);

  // Auto-fire translations queued by external publishers (today: the
  // chat text-selection toolbar's Translate action, which sets
  // `target: "zh"` so the snippet is translated into Chinese). Runs
  // whenever `input`/`model`/`isStreaming` settle: the model list
  // loads asynchronously, so the request can only fire once
  // `model` is non-null. We also gate on `input === queued.text` so
  // the auto-fire is cancelled if the user edits the textarea
  // before the model finishes loading (their edit takes priority).
  // Once consumed, `autoFireRef.current` is cleared so later state
  // changes (e.g. `isStreaming` flipping back to false) don't
  // re-trigger it.
  useEffect(() => {
    const queued = autoFireRef.current;
    if (!queued) return;
    if (isStreaming) return;
    if (!model) return;
    if (input.trim() !== queued.text.trim()) {
      autoFireRef.current = null;
      return;
    }
    autoFireRef.current = null;
    start({ text: queued.text, target: queued.target, provider: model.provider, modelId: model.modelId });
  }, [input, model, isStreaming, start]);

  // Translation fires only when the user clicks the Translate button (or hits
  // Cmd/Ctrl+Enter). handleTranslate doubles as Stop while a request is
  // in-flight so the same button covers both states.

  const handleTranslate = useCallback(() => {
    if (isStreaming) {
      stop();
      return;
    }
    const trimmed = input.trim();
    if (!trimmed || !model) return;
    start({ text: trimmed, target, provider: model.provider, modelId: model.modelId });
  }, [input, isStreaming, model, start, stop, target]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

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

  const modelOptions: ModelOption[] = useMemo(
    () => modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })),
    [modelList],
  );

  const modelsByProvider = useMemo(() => {
    const groups: { provider: string; options: ModelOption[] }[] = [];
    for (const opt of modelOptions) {
      const g = groups.find((x) => x.provider === opt.provider);
      if (g) g.options.push(opt);
      else groups.push({ provider: opt.provider, options: [opt] });
    }
    return groups;
  }, [modelOptions]);

  const currentName = useMemo(() => {
    if (!model) return null;
    return modelOptions.find((o) => o.provider === model.provider && o.modelId === model.modelId)?.name ?? model.modelId;
  }, [model, modelOptions]);

  // Height cap for the model dropdown (space below the trigger). SSR-safe:
  // the dropdown stays mounted even while closed, so `window` is guarded.
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const modelDropdownMaxH = Math.max(120, Math.min(viewportHeight - (modelDropdownRect?.top ?? 0) - 40, 360));

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "transparent",
    }}>
      {/* Top bar: model selector + target selector + copy + clear */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
        flexShrink: 0, position: "relative",
      }}>
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
              setModelDropdownOpen((v) => !v);
            }}
            disabled={isStreaming || !currentName}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 10px", height: 28,
              maxWidth: 240, overflow: "hidden",
              background: modelDropdownOpen ? "var(--bg-hover)" : "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              cursor: isStreaming ? "not-allowed" : "pointer",
              fontSize: 12,
              opacity: isStreaming ? 0.5 : 1,
            }}
          >
            <ProviderIcon
              id={resolveProviderIcon(model?.provider, model?.modelId, modelIcons) ?? ""}
              size={12}
              fallback={<ProviderGearIcon size={11} />}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentName ?? t("Model")}
            </span>
          </button>
          <AnimatedPopover
            open={modelDropdownOpen}
            maxHeight={modelDropdownMaxH}
            panelRef={panelRef}
            style={{
              position: "fixed",
              ...(modelDropdownRect
                ? { top: modelDropdownRect.top + 32, left: modelDropdownRect.left }
                : { top: -9999, left: 0 }),
              zIndex: 500,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
              width: "max-content",
              minWidth: modelDropdownRect?.width ?? 0,
            }}
          >
              {modelsByProvider.map((group, gi) => (
                <div key={group.provider}>
                  {modelsByProvider.length > 1 && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 12px 4px",
                      fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                      textTransform: "uppercase", letterSpacing: "0.07em",
                      borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                    }}>
                      <ProviderIcon id={resolveProviderIcon(group.provider, undefined, modelIcons) ?? ""} size={10} fallback={<ProviderGearIcon size={9} />} />
                      <span>{group.provider}</span>
                    </div>
                  )}
                  {group.options.map((opt) => {
                    const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                    return (
                      <button
                        key={`${opt.provider}:${opt.modelId}`}
                        onClick={() => {
                          setModelDropdownOpen(false);
                          if (!isActive) {
                            setModel({ provider: opt.provider, modelId: opt.modelId });
                          }
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", padding: "7px 12px",
                          background: isActive ? "var(--bg-selected)" : "none",
                          border: "none",
                          color: isActive ? "var(--text)" : "var(--text-muted)",
                          cursor: "pointer", fontSize: 12, textAlign: "left",
                          fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap",
                        }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? "var(--bg-selected)" : "none"; }}
                      >
                        {isActive
                          ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                          : <span style={{ width: 10, flexShrink: 0 }} />}
                        <ProviderIcon id={resolveProviderIcon(opt.provider, opt.modelId, modelIcons) ?? ""} size={12} fallback={<ProviderGearIcon size={11} />} />
                        {opt.name}
                      </button>
                    );
                  })}
                </div>
              ))}
          </AnimatedPopover>
        </div>
        {/* Target-language toggle. A single button whose label always shows
            the *current* target language ("to中文" / "to英文"); clicking
            switches the target to the other language. The label is keyed by
            `target` so React remounts the <span> on every switch,
            re-firing the `lang-swap-in` keyframe from globals.css for the
            "切换感". `minWidth` keeps the button from jittering between the
            two label widths. */}
        <Tooltip
          content={t("Current target: {lang}", { lang: t(target === "zh" ? "Chinese" : "English") })}
        >
          <button
            onClick={() => { if (!isStreaming) setTarget(target === "en" ? "zh" : "en"); }}
            disabled={isStreaming}
            aria-label={t("Switch to {lang}", { lang: t(target === "zh" ? "English" : "Chinese") })}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "0 10px", height: 28,
              minWidth: 96,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              cursor: isStreaming ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 500,
              opacity: isStreaming ? 0.5 : 1,
              overflow: "hidden",
              transition: "background-color 0.15s, border-color 0.15s, transform 0.1s",
            }}
            onMouseEnter={(e) => {
              if (isStreaming) return;
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.borderColor = "var(--text-dim)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg)";
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseDown={(e) => { if (!isStreaming) e.currentTarget.style.transform = "scale(0.95)"; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            onBlur={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            {/* Swap arrows icon — a left-pointing and right-pointing chevron
                stacked, hinting that the button *swaps* something. */}
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ flexShrink: 0, opacity: 0.7 }}
            >
              <path d="M3 7h13" />
              <path d="M16 4l3 3-3 3" />
              <path d="M21 17H8" />
              <path d="M8 20l-3-3 3-3" />
            </svg>
            <span
              key={target}
              style={{
                display: "inline-block",
                whiteSpace: "nowrap",
                animation: "lang-swap-in 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)",
              }}
            >
              {t(target === "zh" ? "toChinese" : "toEnglish")}
            </span>
          </button>
        </Tooltip>
        <Tooltip content={isStreaming ? t("Stop") : (input.trim() ? t("Translate (⌘+Enter)") : t("Type text to translate…"))}>
          <button
            onClick={handleTranslate}
            disabled={!isStreaming && (!input.trim() || !model)}
            aria-label={isStreaming ? t("Stop") : t("Translate")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, padding: 0, height: 28,
              background: isStreaming ? "var(--bg)" : "var(--accent)",
              color: isStreaming ? "var(--text)" : "var(--accent-fg, #fff)",
              border: "1px solid var(--border)", borderRadius: 6,
              cursor: (!isStreaming && (!input.trim() || !model)) ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 600,
              opacity: (!isStreaming && (!input.trim() || !model)) ? 0.5 : 1,
            }}
          >
            {isStreaming ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5h12" />
                <path d="M9 3v2" />
                <path d="M5 5c0 4 3 7 6 9" />
                <path d="M11 5c0 3-2 6-6 8" />
                <path d="M14 21l5-12 5 12" />
                <path d="M15.5 17h7" />
              </svg>
            )}
          </button>
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Tooltip content={t("Prompt preview")}>
          <button
            onClick={() => setPreviewOpen((v) => !v)}
            aria-pressed={previewOpen}
            aria-label={t("Prompts")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, padding: 0, height: 28,
              background: previewOpen ? "var(--bg-hover)" : "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 6,
              cursor: "pointer", fontSize: 12,
              transition: "gap 0.15s",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
          </button>
        </Tooltip>
      </div>

      {/* Prompt preview pane — read-only view of the active target's prompt.
          Updates live when target changes (no state sync needed). */}
      {previewOpen && (
        <div style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "transparent",
          flexShrink: 0,
          display: "flex", flexDirection: "column", gap: 6,
          maxHeight: 220,
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontSize: 11, color: "var(--text)",
          }}>
            <span>
              {t("Prompt preview")}
              {" · "}
              {t(target === "zh" ? "Chinese" : "English")}
            </span>
            <Tooltip content={t("Close")}>
              <button
                onClick={() => setPreviewOpen(false)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 20, height: 20, padding: 0,
                  background: "transparent",
                  color: "var(--text-dim)",
                  border: "none", borderRadius: 4,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="2" y1="2" x2="8" y2="8" />
                  <line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            </Tooltip>
          </div>
          <pre style={{
            margin: 0,
            padding: "8px 10px",
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.5,
            overflowY: "auto",
            flex: 1, minHeight: 0,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {TRANSLATE_PROMPTS[target]}
          </pre>
        </div>
      )}

      {/* Input area — flex: 1 so it shares the panel height 1:1 with the output area. */}
      <div style={{ padding: "10px 12px 6px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>
          {t("Translation input")}
        </div>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter triggers translation (or stops, if streaming).
            // Plain Enter still inserts a newline — translation is an
            // explicit action, not an auto-fire.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleTranslate();
            }
          }}
          placeholder={t("Type text to translate…")}
          spellCheck={false}
          style={{
            width: "100%", flex: 1, minHeight: 0, resize: "none",
            padding: "8px 10px",
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.5,
            boxSizing: "border-box",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
        />
      </div>

      {/* Output area */}
      <div style={{ padding: "0 12px 12px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 11, color: "var(--text-dim)", marginBottom: 4, minHeight: 16,
        }}>
          <span>{t("Translation output")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Tooltip content={t("Copy")}>
              <button
                onClick={handleCopy}
                disabled={!output}
                aria-label={t("Copy")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 24, height: 20, padding: 0,
                  background: "transparent", color: "var(--text-muted)",
                  border: "none", borderRadius: 4,
                  cursor: !output ? "not-allowed" : "pointer",
                  opacity: !output ? 0.5 : 1,
                }}
              >
                <MorphToggleIcon from={COPY} to={CHECK} active={copied} size={12} />
              </button>
            </Tooltip>
            {isStreaming && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)" }}>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" style={{ animation: "pulse 1.2s infinite" }}>
                <circle cx="5" cy="5" r="3" />
              </svg>
              <span>{t("Translating…")}</span>
              <Tooltip content={t("Stop")}>
                <button
                  onClick={handleStop}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 18, height: 18, padding: 0,
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.borderColor = "var(--text-muted)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                >
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
                </button>
              </Tooltip>
            </span>
            )}
          </div>
        </div>
        <div
          ref={outputRef}
          data-scroll-wide
          style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            padding: "10px 12px",
            background: "transparent",
            color: error ? "#ef4444" : "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 13, lineHeight: 1.6,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            fontFamily: "var(--font-mono)",
          }}
        >
          {error ? error : output || (
            <span style={{ color: "var(--text-dim)" }}>{t("Translated text will appear here")}</span>
          )}
        </div>
      </div>
    </div>
  );
}