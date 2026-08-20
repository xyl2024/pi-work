/**
 * TaskPromptTab — read-only view of the configured prompt.
 *
 * Shows the prompt in a monospace, preformatted block so users can read
 * what the agent will receive. A copy button puts the text on the
 * clipboard; the iframe-allowed clipboard write is documented at the
 * top-level (see project AGENTS.md "Clipboard in the Electron Shell").
 */

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import type { ScheduledTask } from "./types";
import { IconCheck, IconCopy } from "./icons";

interface Props {
  task: ScheduledTask;
}

export function TaskPromptTab({ task }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(task.prompt);
      setCopied(true);
      toast.show({ kind: "success", message: t("Copied") });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.show({ kind: "error", message: t("Copy failed") });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {t("Prompt (sent to agent at trigger time)")}
        </span>
        <button
          onClick={() => void copy()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 9px",
            fontSize: 11,
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 5,
            color: copied ? "var(--success)" : "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {copied ? <IconCheck width={10} height={10} /> : <IconCopy width={10} height={10} />}
          {copied ? t("Copied") : t("Copy")}
        </button>
      </div>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: "12px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.6,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowY: "auto",
          minHeight: 120,
        }}
      >
        {task.prompt}
      </pre>
    </div>
  );
}