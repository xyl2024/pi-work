"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/client/clipboard";
import { selectModelsConfigDirty, useModelsConfigPanel } from "@/lib/client/models-config-panel";
import type { ModelConnectionTestResult } from "@/lib/shared/model-connection-test";

export function ModelConnectionTest({ provider, modelId, disabled = false }: {
  provider: string; modelId: string; disabled?: boolean;
}) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const blocked = disabled || selectModelsConfigDirty(state) || state.saving || !!state.rawEdit;
  const [result, setResult] = useState<ModelConnectionTestResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null);
    setError("");
    return () => { controller.current?.abort(); };
  }, [provider, modelId]);

  const run = async () => {
    if (controller.current || blocked) return;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setResult(null);
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, modelId }),
        signal: abort.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const data: ModelConnectionTestResult = await response.json();
      if (!abort.signal.aborted) setResult(data);
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : t("Network error"));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRunning(false);
      }
    }
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" disabled={blocked || running || !modelId} onClick={() => { void run(); }}
          style={{ padding: "4px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", cursor: blocked || running ? "default" : "pointer", opacity: blocked || running ? 0.5 : 1 }}>
          {t(running ? "Testing connection..." : "Test connection")}
        </button>
        {running && <button type="button" onClick={() => {
          controller.current?.abort();
          controller.current = null;
          setRunning(false);
        }}>{t("Cancel")}</button>}
        {result && <span role="status" style={{ color: result.ok ? "var(--text)" : "var(--error)" }}>
          {t(result.ok ? "Connection successful" : "Connection failed")} · {result.durationMs} ms
        </span>}
      </div>
      {error && <div role="alert" style={{ color: "var(--error)", whiteSpace: "pre-wrap" }}>{error}</div>}
      {result && <details open>
        <summary>{t("Connection diagnostics")}</summary>
        <button type="button" onClick={() => {
          void copyText(JSON.stringify(result, null, 2)).then(() => setCopied(true)).catch(() => setError(t("Network error")));
        }}>{t(copied ? "Copied" : "Copy")}</button>
        {result.truncated && <div>{t("Diagnostics truncated")}</div>}
        <pre style={{ maxHeight: 480, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 8, background: "var(--bg)", userSelect: "text" }}>
          {JSON.stringify({ ok: result.ok, startedAt: result.startedAt, durationMs: result.durationMs, firstEventMs: result.firstEventMs, error: result.error }, null, 2)}
          {"\n\n"}{result.diagnostics}
        </pre>
      </details>}
    </section>
  );
}
