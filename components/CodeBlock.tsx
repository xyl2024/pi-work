"use client";

import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/Tooltip";
import { MorphToggleIcon } from "./MorphToggleIcon";
import { COPY, CHECK } from "@/lib/icon-paths";

interface Props {
  code: string;
  lang: string;
}

/**
 * Shared syntax-highlighted code block with language label and copy button.
 * The header bar is hidden by default — the language label + copy button
 * appear as a floating overlay when the block is hovered. Used by MessageView,
 * FileViewer (markdown preview), and TodoDescriptionView so the todo panel
 * renders code blocks the same way as the file viewer.
 */
export function CodeBlock({ code, lang }: Props) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Floating overlay is fully invisible: no background / border / shadow —
  // the label and copy button read as plain text floating over the code.
  // Colors are theme-aware so the text stays legible against either the
  // dark or light SyntaxHighlighter palette.
  const buttonColor = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.78)";
  const labelColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";

  const copy = () => {
    copyText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Silent — UI just doesn't flip to "Copied". Surface a console hint
        // so debugging is possible without a visible failure.
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
        marginBottom: 8,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid var(--border)",
        background: "var(--bg)",
        boxShadow: isDark
          ? "0 6px 18px rgba(0,0,0,0.35)"
          : "0 4px 14px rgba(0,0,0,0.08)",
      }}
    >
      <SyntaxHighlighter
        language={lang || "text"}
        style={isDark ? vscDarkPlus : vs}
        customStyle={{
          margin: 0,
          padding: "10px 12px",
          fontSize: 12.5,
          lineHeight: 1.6,
          borderRadius: 0,
          background: "var(--bg)",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
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
              // Copied flips the icon to a green checkmark so the success
              // state is recognizable without reintroducing any text.
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
  );
}

// Best-effort clipboard write. Tries the async Clipboard API first (may
// reject in insecure / unfocused contexts — e.g. HTTP localhost with the
// window blurred) and falls through to the legacy execCommand path. Rejects
// only if both paths fail.
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the execCommand fallback below.
    }
  }
  if (typeof document === "undefined" || !document.body) {
    throw new Error("clipboard unavailable");
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  ta.setAttribute("readonly", "");
  document.body.appendChild(ta);
  const selection = document.getSelection();
  const savedRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  // execCommand is deprecated but still the only reliable fallback for
  // non-secure / non-focused contexts where the Clipboard API rejects.
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  if (savedRange && selection) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }
  if (!ok) throw new Error("clipboard unavailable");
}
