"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/client/clipboard";
import {
  saveModelsConfig,
  selectModelsConfigDirty,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import type { ModelConnectionTestResult } from "@/lib/shared/model-connection-test";
import styles from "./ConnectionTest.module.css";

export function ModelConnectionTest({ provider, modelId, disabled = false, sticky = false }: {
  provider: string; modelId: string; disabled?: boolean; sticky?: boolean;
}) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const dirty = selectModelsConfigDirty(state);
  const rawPending = !!state.rawEdit;
  const blocked = disabled || dirty || state.saving || rawPending;
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

  const perform = async () => {
    if (controller.current || !modelId) return;
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

  const run = () => {
    if (blocked) return;
    void perform();
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
  };

  const saveAndRun = async () => {
    if (running || state.saving || rawPending) return;
    const saved = await saveModelsConfig();
    if (!saved.ok) {
      setError(saved.error ?? t("Save failed"));
      return;
    }
    await perform();
  };

  return (
    <section className={styles.dock} data-sticky={sticky ? "true" : undefined}>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.testButton}
          disabled={blocked || running || !modelId}
          onClick={run}
        >
          {t(running ? "Testing connection..." : "Test connection")}
        </button>
        {running && (
          <button type="button" className={styles.ghostButton} onClick={cancel}>
            {t("Cancel")}
          </button>
        )}
        {result && (
          <span role="status" className={styles.status} data-ok={result.ok ? "true" : "false"}>
            {t(result.ok ? "Connection successful" : "Connection failed")} · {result.durationMs} ms
          </span>
        )}
        {dirty && !running && (
          <span className={styles.notice}>
            {t("Save changes before testing.")}
            <button
              type="button"
              className={styles.linkButton}
              disabled={state.saving || rawPending}
              onClick={() => { void saveAndRun(); }}
            >
              {t("Save and test")}
            </button>
          </span>
        )}
        {rawPending && !running && <span className={styles.notice}>{t("Apply or cancel raw JSON before testing.")}</span>}
      </div>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {result && (
        <details className={styles.diagnostics}>
          <summary className={styles.diagnosticsSummary}>{t("Connection diagnostics")}</summary>
          <div className={styles.diagnosticsHeader}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => {
                void copyText(JSON.stringify(result, null, 2)).then(() => setCopied(true)).catch(() => setError(t("Network error")));
              }}
            >
              {t(copied ? "Copied" : "Copy")}
            </button>
            {result.truncated && <span className={styles.hint}>{t("Diagnostics truncated")}</span>}
          </div>
          <pre className={styles.diagnosticsBody}>
            {JSON.stringify({ ok: result.ok, startedAt: result.startedAt, durationMs: result.durationMs, firstEventMs: result.firstEventMs, error: result.error }, null, 2)}
            {"\n\n"}{result.diagnostics}
          </pre>
        </details>
      )}
    </section>
  );
}
