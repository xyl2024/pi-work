"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * Shared renderer for unified diff text, used by both GitDiffView
 * (worktree / staged changes) and GitLogView (a file inside a commit).
 * Pure presentational: receives the already-truncated diff + the
 * truncation flag and paints classifyLine-style colored rows.
 */

/** One line of a unified diff, classified for coloring. */
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
          background: "rgba(234,179,8,0.12)", color: "#d97706",
          border: "1px solid rgba(234,179,8,0.3)", borderRadius: 6,
        }}>
          {t("Diff truncated")}
        </div>
      )}
      {/* Wrapper is `inline-block` so it grows with the widest line;
          `minWidth: 100%` keeps short content filling the viewport.
          Child divs are plain `block` and stretch to this wrapper. */}
      <div style={{ display: "inline-block", minWidth: "100%" }}>
        {lines.map((line, i) => {
          const type = classifyLine(line);
          const style: React.CSSProperties = {
            padding: "0 10px",
            whiteSpace: "pre",
          };
          if (type === "add") {
            style.background = "rgba(34,197,94,0.13)";
            style.color = "#16a34a";
          } else if (type === "del") {
            style.background = "rgba(239,68,68,0.13)";
            style.color = "#ef4444";
          } else if (type === "hunk") {
            style.background = "rgba(59,130,246,0.1)";
            style.color = "#3b82f6";
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