"use client";

import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { Tooltip } from "@/components/ui/Tooltip";
import { MorphToggleIcon } from "../ui/MorphToggleIcon";
import { COPY, CHECK } from "@/lib/client/icon-paths";
import { copyText } from "@/lib/client/clipboard";

interface Props {
  code: string;
  lang: string;
}

export function CodeBlock({ code, lang }: Props) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [copied, flashCopied] = useTransientFlag();
  const [hovered, setHovered] = useState(false);

  const buttonColor = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.78)";
  const labelColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";

  const copy = () => {
    copyText(code)
      .then(() => {
        flashCopied();
      })
      .catch(() => {
        console.warn("clipboard write failed");
      });
  };

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
          borderRadius: 12,
          background: isDark ? "rgba(0,0,0,0.26)" : "rgba(0,0,0,0.06)",
          filter: "blur(8px)",
        }}
      />
      <div
        style={{
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "var(--bg)",
        }}
        >
      <SyntaxHighlighter
        language={lang || "text"}
        className="syntax-highlighted-code"
        style={isDark ? vscDarkPlus : vs}
        customStyle={{
          margin: 0,
          padding: "10px 12px",
          fontSize: 12.5,
          lineHeight: 1.6,
          borderRadius: 0,
          border: "none",
          background: "var(--bg)",
          overflowX: "auto",
          whiteSpace: "pre",
          wordBreak: "normal",
          overflowWrap: "normal",
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
        {code}
      </SyntaxHighlighter>
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
          transition: "opacity 0.15s ease",
        }}
      >
        {lang && (
          <span
            style={{
              fontSize: 11,
              color: labelColor,
              fontFamily: "var(--font-sans)",
              maxWidth: 160,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lang}
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
              color: copied ? "#22c55e" : buttonColor,
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
