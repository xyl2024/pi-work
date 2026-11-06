import type { ScheduledTask } from "@/lib/shared/scheduler";

interface Props {
  task: ScheduledTask;
}

export function TaskPromptTab({ task }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <pre
        data-scroll-inset
        style={{
          margin: 0,
          padding: "10px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.6,
          background: "transparent",
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
