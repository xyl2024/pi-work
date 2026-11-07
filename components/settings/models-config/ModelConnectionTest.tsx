"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/client/clipboard";
import { selectModelsConfigDirty, useModelsConfigPanel } from "@/lib/client/models-config-panel";
import type { ModelConnectionTestResult } from "@/lib/shared/model-connection-test";
import styles from "./ModelConnectionTest.module.css";

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
    <section className={styles.section}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.testButton}
          disabled={blocked || running || !modelId}
          onClick={() => { void run(); }}
        >
          {t(running ? "Testing connection..." : "Test connection")}
        </button>
        {running && (
          <button
            type="button"
            className={styles.cancelButton}
            onClick={() => {
              controller.current?.abort();
              controller.current = null;
              setRunning(false);
            }}
          >
            {t("Cancel")}
          </button>
        )}
        {result && (
          <span role="status" className={styles.status} data-ok={result.ok ? "true" : "false"}>
            {t(result.ok ? "Connection successful" : "Connection failed")} · {result.durationMs} ms
          </span>
        )}
      </div>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {result && (
        <details open>
          <summary className={styles.summary}>{t("Connection diagnostics")}</summary>
          <div className={styles.diagnostics}>
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => {
                void copyText(JSON.stringify(result, null, 2)).then(() => setCopied(true)).catch(() => setError(t("Network error")));
              }}
            >
              {t(copied ? "Copied" : "Copy")}
            </button>
            {result.truncated && <div className={styles.truncated}>{t("Diagnostics truncated")}</div>}
            <pre className={styles.dump}>
              {JSON.stringify({ ok: result.ok, startedAt: result.startedAt, durationMs: result.durationMs, firstEventMs: result.firstEventMs, error: result.error }, null, 2)}
              {"\n\n"}{result.diagnostics}
            </pre>
          </div>
        </details>
      )}
    </section>
  );
}
