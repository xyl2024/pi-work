import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import type { ScheduledTask } from "@/lib/shared/scheduler";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { copyText } from "@/lib/client/clipboard";

interface Props {
  task: ScheduledTask;
}

export function TaskPromptTab({ task }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyText(task.prompt);
      setCopied(true);
      toast.show({ kind: "success", message: t("Copied") });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.show({ kind: "error", message: t("Copy failed") });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => void copy()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            fontSize: 12,
            background: "transparent",
            borderRadius: 5,
            color: copied ? "var(--success)" : "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {copied ? <CheckIcon width={10} height={10} /> : <CopyIcon width={10} height={10} />}
          {copied ? t("Copied") : t("Copy")}
        </button>
      </div>
      <pre
        data-scroll-inset
        style={{
          margin: 0,
          padding: "10px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.6,
          background: "var(--bg-subtle)",
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowY: "auto",
        }}
      >
        {task.prompt}
      </pre>
    </div>
  );
}
