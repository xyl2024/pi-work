"use client";

import { useI18n } from "@/hooks/useI18n";

type DiffLineType = "file" | "hunk" | "add" | "del" | "meta" | "context";

function classifyLine(line: string): DiffLineType {
  if (line.startsWith("diff --git ") || line.startsWith("index ") ||
      line.startsWith("new file ") || line.startsWith("deleted file ") ||
      line.startsWith("Binary files ")) {
    return "file";
  }
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("\\")) return "meta";
  return "context";
}

export function GitDiffViewer({ diff, truncated }: { diff: string; truncated: boolean }) {
  const { t } = useI18n();
  const lines = diff.split("\n");
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.55, padding: "4px 0" }}>
      {truncated && (
        <div style={{
          margin: "4px 10px", padding: "6px 10px", fontSize: 11,
          background: "var(--warning-bg)", color: "var(--warning)",
          border: "1px solid color-mix(in srgb, var(--warning) 25%, transparent)", borderRadius: "var(--radius-sm)",
        }}>
          {t("Diff truncated")}
        </div>
      )}
      <div style={{ display: "inline-block", minWidth: "100%" }}>
        {lines.map((line, i) => {
          const type = classifyLine(line);
          const style: React.CSSProperties = {
            padding: "0 10px",
            whiteSpace: "pre",
          };
          if (type === "add") {
            style.background = "var(--diff-add-bg)";
            style.color = "var(--diff-add-text)";
          } else if (type === "del") {
            style.background = "var(--diff-del-bg)";
            style.color = "var(--diff-del-text)";
          } else if (type === "hunk") {
            style.background = "var(--diff-hunk-bg)";
            style.color = "var(--info)";
          } else if (type === "file") {
            style.color = "var(--text-muted)";
            style.fontWeight = 600;
          } else if (type === "meta") {
            style.color = "var(--text-dim)";
          } else {
            style.color = "var(--text)";
          }
          return <div key={i} style={style}>{line || " "}</div>;
        })}
      </div>
    </div>
  );
}