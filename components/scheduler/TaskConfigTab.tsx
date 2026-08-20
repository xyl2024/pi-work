/**
 * TaskConfigTab — read-only view of a task's execution config.
 *
 * Mirrors the structure of the form's "Basic config" section so the user
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
  const { provider, modelId, thinkingLevel, toolNames, cwd, maxLifetimeMs } = task;

  // Render the max lifetime as a human-friendly "Xh Ym" string. The
  // server-side default is 2h, kept in sync with lib/scheduler/runner.ts.
  const DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;
  const lifetimeDisplay = (() => {
    const ms = maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
    const totalMinutes = Math.round(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    return `${minutes}m`;
  })();

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

      <ConfigRow label="Provider" value={provider ? <code style={mono}>{provider}</code> : <Missing>{t("Not set")}</Missing>} />
      <ConfigRow label={t("Model")} value={modelId ? <code style={mono}>{modelId}</code> : <Missing>{t("Not set")}</Missing>} />
      <ConfigRow label={t("Thinking level")} value={thinkingLevel && thinkingLevel !== "auto" ? thinkingLevel : <Missing>{t("Not set")}</Missing>} />
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
      <ConfigRow
        label={t("Max lifetime")}
        value={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <code style={mono}>{lifetimeDisplay}</code>
            {maxLifetimeMs === null && (
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>({t("default")})</span>
            )}
          </span>
        }
      />
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

// `Provider` / `Model` / `Thinking level` are all required on scheduled tasks.
// A missing or "auto" value means an old task needs re-picking — surface that
// as an obvious error-tinted "Not set" so the user knows to open Modify.
function Missing({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--error)", fontSize: 11 }}>{children}</span>;
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