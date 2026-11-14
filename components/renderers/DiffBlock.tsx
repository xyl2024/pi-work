"use client";

import { useMemo, useState } from "react";
import {
  parseDiffBlock,
  diffRows,
  isDiffFoldable,
  foldDiffRows,
  truncateDiffRows,
  DIFF_TRUNCATE_LIMIT,
  type DiffFile,
  type DiffFoldSegment,
  type DiffLine,
} from "@/lib/shared/diff-block";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { Tooltip } from "@/components/ui/Tooltip";
import { MorphToggleIcon } from "../ui/MorphToggleIcon";
import { COPY, CHECK } from "@/lib/client/icon-paths";
import { copyText } from "@/lib/client/clipboard";
import { CodeBlock } from "./CodeBlock";

interface Props {
  code: string;
  isStreaming?: boolean;
}

const LINE_STYLE: Record<string, React.CSSProperties> = {
  add: { background: "var(--diff-add-bg)", color: "var(--diff-add-text)" },
  del: { background: "var(--diff-del-bg)", color: "var(--diff-del-text)" },
  context: {},
};

interface FilePlan {
  rows: DiffLine[];
  segments: DiffFoldSegment[];
  truncated: boolean;
  total: number;
}

function fileLabel(file: DiffFile): string {
  if (file.oldPath && file.newPath && file.oldPath !== file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? "";
}

function FoldButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "3px 12px",
        border: "none",
        background: "var(--diff-hunk-bg)",
        borderTop: "1px solid var(--border-soft)",
        borderBottom: "1px solid var(--border-soft)",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        textAlign: "left",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {t("Expand {n} lines", { n: count })}
    </button>
  );
}

function LineRow({ line, hasHunks }: { line: DiffLine; hasHunks: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "0 12px",
        minHeight: "1.6em",
        ...LINE_STYLE[line.type],
      }}
    >
      {hasHunks && (
        <>
          <span
            style={{
              width: "3.5em",
              flexShrink: 0,
              textAlign: "right",
              paddingRight: 8,
              color: "var(--text-muted)",
              userSelect: "none",
            }}
          >
            {line.oldLine ?? ""}
          </span>
          <span
            style={{
              width: "3.5em",
              flexShrink: 0,
              textAlign: "right",
              paddingRight: 8,
              color: "var(--text-muted)",
              userSelect: "none",
            }}
          >
            {line.newLine ?? ""}
          </span>
        </>
      )}
      <span style={{ flex: 1, whiteSpace: "pre" }}>{line.text}</span>
    </div>
  );
}

function VisibleRange({
  plan,
  start,
  end,
  hasHunks,
}: {
  plan: FilePlan;
  start: number;
  end: number;
  hasHunks: boolean;
}) {
  const nodes: React.ReactNode[] = [];
  for (let i = start; i <= end; i++) {
    const line = plan.rows[i];
    if (line.type !== "hunk") {
      nodes.push(<LineRow key={`l-${i}`} line={line} hasHunks={hasHunks} />);
    }
  }
  return <>{nodes}</>;
}

function TruncatedHint({ total }: { total: number }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        padding: "4px 12px",
        fontSize: 11,
        color: "var(--text-dim)",
        fontFamily: "var(--font-mono)",
        fontStyle: "italic",
      }}
    >
      {t("Truncated, {total} lines in total", { total })}
    </div>
  );
}

export function DiffBlock({ code, isStreaming }: Props) {
  const result = useMemo(() => parseDiffBlock(code), [code]);
  const { t } = useI18n();
  const [copied, flashCopied] = useTransientFlag();
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const plan = useMemo<FilePlan[]>(() => {
    if (!result.renderable) return [];
    return result.files.map((file) => {
      const { rows, truncated, total } = truncateDiffRows(diffRows(file), DIFF_TRUNCATE_LIMIT);
      const fold = isDiffFoldable(rows.length, Boolean(isStreaming));
      const segments: DiffFoldSegment[] = fold
        ? foldDiffRows(rows)
        : [{ kind: "visible", start: 0, end: rows.length - 1 }];
      return { rows, segments, truncated, total };
    });
  }, [result, isStreaming]);

  const expand = (key: string) => {
    setExpanded((prev) => new Set(prev).add(key));
  };

  if (!result.renderable) {
    return <CodeBlock code={code} lang="diff" />;
  }

  const copy = () => {
    copyText(code)
      .then(flashCopied)
      .catch(() => {
        console.warn("clipboard write failed");
      });
  };

  const statParts = [
    result.additions > 0 ? `+${result.additions}` : null,
    result.deletions > 0 ? `−${result.deletions}` : null,
  ].filter(Boolean);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        marginTop: 8,
        marginBottom: 12,
        marginRight: 10,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 34,
          left: 34,
          right: -2,
          bottom: -2,
          borderRadius: "var(--radius-md)",
          background: "rgba(0,0,0,0.06)",
          filter: "blur(8px)",
        }}
      />
      <div
        style={{
          position: "relative",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <div
          className="syntax-highlighted-code"
          style={{
            overflowX: "auto",
            padding: "10px 0",
            fontSize: 12,
            lineHeight: 1.6,
            fontFamily: "var(--font-mono)",
            whiteSpace: "pre",
          }}
        >
          {result.files.map((file, fi) => (
            <div key={fi}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  color: "var(--text)",
                  background: "var(--bg-elevated)",
                  borderTop: fi > 0 ? "1px solid var(--border-soft)" : undefined,
                  borderBottom: "1px solid var(--border-soft)",
                }}
              >
                {fileLabel(file)}
              </div>
              {plan[fi].segments.map((segment, si) => {
                if (segment.kind === "collapsed") {
                  const key = `${fi}-${segment.start}`;
                  if (!expanded.has(key)) {
                    return (
                      <FoldButton
                        key={`f-${fi}-${si}`}
                        count={segment.count}
                        onClick={() => expand(key)}
                      />
                    );
                  }
                  return (
                    <VisibleRange
                      key={`r-${fi}-${si}`}
                      plan={plan[fi]}
                      start={segment.start}
                      end={segment.start + segment.count - 1}
                      hasHunks={result.hasHunks}
                    />
                  );
                }
                if (segment.start > segment.end) return null;
                return (
                  <VisibleRange
                    key={`r-${fi}-${si}`}
                    plan={plan[fi]}
                    start={segment.start}
                    end={segment.end}
                    hasHunks={result.hasHunks}
                  />
                );
              })}
              {plan[fi].truncated && <TruncatedHint total={plan[fi].total} />}
            </div>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "2px 4px",
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity var(--dur-base) var(--ease-standard)",
          }}
        >
          {statParts.length > 0 && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {statParts.join(" ")}
            </span>
          )}
          <Tooltip content={copied ? t("copied") : t("copy")}>
            <button
              onClick={copy}
              aria-label={copied ? t("copied") : t("copy")}
              style={{
                display: "flex",
                alignItems: "center",
                background: "none",
                border: "none",
                color: copied ? "var(--success)" : "var(--text-muted)",
                cursor: "pointer",
                padding: 2,
                lineHeight: 0,
              }}
            >
              <MorphToggleIcon from={COPY} to={CHECK} active={copied} size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
