/**
 * TaskConfigTab — read-only view of a task's execution config.
 *
 * Mirrors the structure of the form's "Execution" section so the user
 * can review what the task will run with without accidentally editing
 * anything. Each row has a small "modify" link that scrolls up to the
 * edit button (parent handler will pop the form modal).
 */

import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ScheduledTask } from "./types";

interface Props {
  task: ScheduledTask;
  onEdit: () => void;
}

export function TaskConfigTab({ task, onEdit }: Props) {
  const { t } = useI18n();
  const { provider, modelId, thinkingLevel, toolNames, cwd } = task;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("Here is the task's current execution config. Click modify to jump to the edit form.")}
        </span>
        <button
          onClick={onEdit}
          style={{
            padding: "4px 12px",
            fontSize: 11,
            fontWeight: 600,
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t("Modify config")}
        </button>
      </header>

      <ConfigRow label="Provider" value={provider ? <code style={mono}>{provider}</code> : <Muted>{t("Use default")}</Muted>} />
      <ConfigRow label={t("Model")} value={modelId ? <code style={mono}>{modelId}</code> : <Muted>{t("Use default")}</Muted>} />
      <ConfigRow label={t("Thinking level")} value={thinkingLevel ?? <Muted>{t("Default")}</Muted>} />
      <ConfigRow
        label={t("Tools")}
        value={
          toolNames === null
            ? t("All available tools")
            : toolNames.length === 0
              ? <Muted>{t("No tools, chat only")}</Muted>
              : toolNames.join(", ")
        }
      />
      <ConfigRow label={t("Working directory")} value={<code style={mono}>{cwd}</code>} />
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 12,
        alignItems: "center",
        padding: "8px 12px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: "var(--text)", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--text-muted)" }}>{children}</span>;
}

const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  padding: "1px 5px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  color: "var(--text)",
};