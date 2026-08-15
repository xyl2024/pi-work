/**
 * TaskConfigTab — read-only view of a task's execution config.
 *
 * Mirrors the structure of the form's "Execution" section so the user
 * can review what the task will run with without accidentally editing
 * anything. Each row has a small "modify" link that scrolls up to the
 * edit button (parent handler will pop the form modal).
 */

import type { CSSProperties } from "react";
import type { ScheduledTask } from "./types";

interface Props {
  task: ScheduledTask;
  onEdit: () => void;
}

export function TaskConfigTab({ task, onEdit }: Props) {
  const { provider, modelId, thinkingLevel, toolNames, cwd } = task;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          以下是任务当前的执行配置。点击修改按钮跳转到编辑表单。
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
          修改配置
        </button>
      </header>

      <ConfigRow label="Provider" value={provider ? <code style={mono}>{provider}</code> : <Muted>使用默认</Muted>} />
      <ConfigRow label="模型" value={modelId ? <code style={mono}>{modelId}</code> : <Muted>使用默认</Muted>} />
      <ConfigRow label="推理强度" value={thinkingLevel ?? <Muted>默认</Muted>} />
      <ConfigRow
        label="工具"
        value={
          toolNames === null
            ? "全部可用工具"
            : toolNames.length === 0
              ? <Muted>无工具,纯对话</Muted>
              : toolNames.join(", ")
        }
      />
      <ConfigRow label="工作目录" value={<code style={mono}>{cwd}</code>} />
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
  return <span style={{ color: "var(--text-dim)" }}>{children}</span>;
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