"use client";

import { useMemo, useState } from "react";
import { parseDiffBlock, type DiffFile } from "@/lib/shared/diff-block";
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

function fileLabel(file: DiffFile): string {
  if (file.oldPath && file.newPath && file.oldPath !== file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? "";
}

function HunkSeparator() {
  return (
    <div
      aria-hidden
      style={{
        height: 8,
        background: "var(--diff-hunk-bg)",
        borderTop: "1px solid var(--border-soft)",
        borderBottom: "1px solid var(--border-soft)",
      }}
    />
  );
}

export function DiffBlock({ code }: Props) {
  const result = useMemo(() => parseDiffBlock(code), [code]);
  const { t } = useI18n();
  const [copied, flashCopied] = useTransientFlag();
  const [hovered, setHovered] = useState(false);

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
              {file.lines.map((line, li) => {
                if (line.type === "meta" || line.type === "file") return null;
                if (line.type === "hunk") return <HunkSeparator key={`${fi}-${li}`} />;
                return (
                  <div
                    key={`${fi}-${li}`}
                    style={{
                      display: "flex",
                      padding: "0 12px",
                      minHeight: "1.6em",
                      ...LINE_STYLE[line.type],
                    }}
                  >
                    {result.hasHunks && (
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
              })}
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
