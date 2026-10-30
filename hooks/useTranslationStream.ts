"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LanguageCode } from "@/lib/shared/translate";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/hooks/useI18n";

export interface TranslationStartParams {
  text: string;
  target: LanguageCode;
  provider: string;
  modelId: string;
}

export interface TranslationStream {
  output: string;
  isStreaming: boolean;
  error: string | null;
  start: (params: TranslationStartParams) => void;
  stop: () => void;
  setOutput: (value: string) => void;
  clearError: () => void;
}

export function useTranslationStream(): TranslationStream {
  const { t } = useI18n();
  const toast = useToast();
  const [output, setOutputState] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const setOutput = useCallback((value: string) => {
    setOutputState(value);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const start = useCallback(async (params: TranslationStartParams) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOutput("");
    setError(null);
    setIsStreaming(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${errText ? `: ${errText}` : ""}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let payload: { type?: string; text?: string; message?: string };
          try { payload = JSON.parse(line.slice(6)); } catch { continue; }
          if (payload.type === "delta" && typeof payload.text === "string") {
            setOutputState((o) => o + payload.text!);
          } else if (payload.type === "error") {
            throw new Error(payload.message || t("Translation failed"));
          }
        }
      }
      setOutputState((o) => o.trim());
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.show({ kind: "error", message: msg || t("Translation failed") });
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setIsStreaming(false);
      }
    }
  }, [toast, t, setOutput]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  return { output, isStreaming, error, start, stop, setOutput, clearError };
}
