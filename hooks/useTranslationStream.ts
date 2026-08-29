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
  /** Begin (or restart) a translation. If a request is already in flight it
   *  is aborted first. Resets `output` and `error` before kicking off. */
  start: (params: TranslationStartParams) => void;
  /** Abort the in-flight request, if any. The hook leaves `output` /
   *  `error` untouched so the caller decides what to display afterwards
   *  (typically a partial translation). */
  stop: () => void;
  /** Setter exposed for rehydration / manual reset (e.g. restoring a
   *  persisted translation when a tab re-opens). Does NOT abort an
   *  in-flight request — call `stop()` first if needed. */
  setOutput: (value: string) => void;
  /** Clear the most recent error without starting a new request. Used
   *  by TranslatePanel's external-push subscriber so a fresh push
   *  from the chat toolbar wipes any prior failure before auto-fire. */
  clearError: () => void;
}

/**
 * Shared streaming-translation client used by both the right-side
 * TranslatePanel and the chat text-selection TranslateBubble.
 *
 * Encapsulates the POST against /api/translate, the SSE framing
 * (`delta` / `error` / `done`), the AbortController wiring, and the
 * final trim() applied to the accumulated output. The hook owns its own
 * `output` / `isStreaming` / `error` state; callers render whatever
 * shape they like.
 *
 * Errors are also surfaced as a toast (matching TranslatePanel's prior
 * behaviour) so the failure is visible even when the consuming surface
 * is dismissed or off-screen. Aborts are *not* toasted — that's an
 * intentional user action, not a failure.
 *
 * SSR-safe: no DOM access at module load. The fetch only runs when the
 * caller invokes `start()`.
 */
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

  // React guarantees state setters are stable references, so listing
  // them in the dep array (as the eslint rule asks) keeps the
  // callback's referential identity stable across renders.
  const setOutput = useCallback((value: string) => {
    setOutputState(value);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const start = useCallback(async (params: TranslationStartParams) => {
    // Replace any in-flight request.
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
          // "done" → loop exits on next read returning done.
        }
      }
      // Strip leading/trailing whitespace (spaces, tabs, newlines) from
      // the final accumulated translation. Models frequently pad the
      // response with surrounding newlines; without this, the user sees
      // a blank line before/after the actual translation.
      setOutputState((o) => o.trim());
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.show({ kind: "error", message: msg || t("Translation failed") });
    } finally {
      // Only reset if we're still the active controller — a newer
      // translation may have taken over while we were unwinding.
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setIsStreaming(false);
      }
    }
  }, [toast, t, setOutput]);

  // Abort any in-flight request on unmount.
  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  return { output, isStreaming, error, start, stop, setOutput, clearError };
}
