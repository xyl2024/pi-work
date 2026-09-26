"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { fileLanguage } from "./utils";
import type { SkillDetailFile } from "./types";

/**
 * One row inside a skill's file tree. Clicking a text file expands a
 * syntax-highlighted preview; sub-file content is fetched lazily from
 * `/api/skills/detail?filePath=...&subFilePath=...` and cached per-path
 * in a ref Map so re-expanding the same row is instant.
 *
 * Pure controlled component: the parent (SkillDetail) owns expansion state
 * and passes `expanded` + `onToggle` down. The file's own exception is
 * the per-path content cache, which is internal to this row.
 */
export function SubFileRow({
  file,
  skillFilePath,
  expanded,
  onToggle,
}: {
  file: SkillDetailFile;
  skillFilePath: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const contentCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (expanded && content === null && !loading) {
      // Check cache first
      const cached = contentCache.current.get(file.relativePath);
      if (cached) {
        setContent(cached);
        return;
      }
      setLoading(true);
      setLoadError(null);
      fetch(
        `/api/skills/detail?filePath=${encodeURIComponent(skillFilePath)}&subFilePath=${encodeURIComponent(file.relativePath)}`,
      )
        .then((r) => r.json())
        .then((d: { subFileContent?: string; error?: string }) => {
          if (d.error) {
            setLoadError(d.error);
            return;
          }
          if (d.subFileContent != null) {
            contentCache.current.set(file.relativePath, d.subFileContent);
            setContent(d.subFileContent);
          }
        })
        .catch((e) => setLoadError(String(e)))
        .finally(() => setLoading(false));
    }
  }, [expanded, content, loading, file.relativePath, skillFilePath]);

  const sizeLabel =
    file.size < 1024
      ? `${file.size} B`
      : file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KiB`
        : `${(file.size / 1024 / 1024).toFixed(1)} MiB`;

  return (
    <div>
      <div
        onClick={() => {
          if (!file.isText) return;
          onToggle();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderRadius: 4,
          cursor: file.isText ? "pointer" : "default",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: "var(--text)",
        }}
      >
        {/* Expand/collapse chevron — points down when expanded, right when
            collapsed (rotates -90deg); matches the sidebar cwd fold arrow.
            Kept as a hidden placeholder for non-previewable files so names
            stay aligned. */}
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 12,
            height: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-dim)",
            transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
            visibility: file.isText ? undefined : "hidden",
          }}
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="2 4 5 7 8 4" />
          </svg>
        </span>
        <span style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            color: "var(--text-dim)",
          }}
        >
          {sizeLabel}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "2px 0 2px 28px" }}>
          {loading ? (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {t("Loading...")}
            </span>
          ) : loadError ? (
            <span style={{ fontSize: 11, color: "var(--error)" }}>
              {loadError === "binary file cannot be previewed"
                ? t("Binary file cannot be previewed")
                : loadError}
            </span>
          ) : content != null ? (
            <SyntaxHighlighter
              language={fileLanguage(file.name)}
              className="syntax-highlighted-code"
              style={isDark ? vscDarkPlus : vs}
              customStyle={{
                margin: 0,
                padding: 10,
                borderRadius: 4,
                background: "var(--bg)",
                fontSize: 11,
                lineHeight: 1.5,
                fontFamily: "var(--font-mono)",
                maxHeight: 300,
                overflow: "auto",
              }}
              codeTagProps={{
                style: {
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "pre",
                  wordBreak: "normal",
                  overflowWrap: "normal",
                },
              }}
            >
              {content}
            </SyntaxHighlighter>
          ) : null}
        </div>
      )}
    </div>
  );
}
