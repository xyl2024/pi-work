"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentMessage, CompactionEntry, CompactionEntryDetails, SessionTreeNode } from "@/lib/types";
import { MessageView } from "./MessageView";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "./Toast";
import { exportMessageAsPng } from "@/lib/export-message-card";

interface Props {
  /** The clicked card's entry id — used to look up the one message this card represents. */
  entryId: string;
  /** Full session tree (roots). Walked to find the entry by id. */
  branchTree: SessionTreeNode[];
  onClose: () => void;
}

/**
 * Find the single AgentMessage that the clicked card represents. The
 * conversation-tree panel emits user/assistant/compaction cards (see
 * `buildConversationTree`), so this returns either a regular message
 * or the summary that belongs to a compaction card.
 */
function findEntry(
  entryId: string,
  roots: SessionTreeNode[],
): { kind: "message"; message: AgentMessage; timestamp: string } | { kind: "compaction"; entry: CompactionEntry } | null {
  const stack: SessionTreeNode[] = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.entry.id !== entryId) {
      // Push in reverse so the leftmost child is popped first; matters
      // only when an id happens to be reused, which shouldn't happen but
      // keeps the walk order predictable.
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
      continue;
    }
    if (node.entry.type === "message") {
      return { kind: "message", message: node.entry.message, timestamp: node.entry.timestamp };
    }
    if (node.entry.type === "compaction") {
      return { kind: "compaction", entry: node.entry };
    }
    return null;
  }
  return null;
}

/**
 * Full-screen modal that renders the single message represented by the
 * clicked card — no truncation, full Markdown / thinking / tool-call
 * rendering via the same MessageView the main chat uses. Click backdrop
 * or press Esc to close. Body scroll is locked while open.
 */
export function BranchMessageViewer({ entryId, branchTree, onClose }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    const source = bodyRef.current;
    if (!source || exporting) return;
    setExporting(true);
    try {
      await exportMessageAsPng(source);
      toast.show({ kind: "success", message: t("Message card exported") });
    } catch (err) {
      // Cross-origin images without CORS headers are the usual culprit.
      console.warn("export message card failed:", err);
      toast.show({ kind: "error", message: t("Failed to export image") });
    } finally {
      setExporting(false);
    }
  };

  const data = useMemo(
    () => findEntry(entryId, branchTree),
    [entryId, branchTree],
  );

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc to close. Skip when focus is in a text input so we don't fight the
  // search box / textarea / contenteditable.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const editable = document.activeElement?.getAttribute("contenteditable");
      if (editable === "true" || editable === "") return;
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!data) {
    // Defensive: the card id wasn't found in the tree. Close rather than
    // render an empty modal — the panel's state will reset on the next
    // tree update.
    return null;
  }

  if (data.kind === "compaction") {
    return <CompactionSummaryView entry={data.entry} onClose={onClose} />;
  }

  const { message, timestamp } = data;
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }
  const role = message.role;
  const roleLabel = role === "user" ? "User" : "Assistant";
  const ts = timestamp ? new Date(timestamp).toLocaleString() : "";

  return (
    <div
      onClick={(e) => {
        // Click on the dim backdrop closes; clicks on the panel itself
        // are caught by the panel's own click handler below.
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(880px, 100%)",
          maxHeight: "calc(100vh - 64px)",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              style={{
                color: "var(--text)",
                fontSize: 12,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {roleLabel}
            </span>
            <span
              style={{
                color: "var(--text-dim)",
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {ts}
            </span>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            title={exporting ? t("Exporting…") : t("Export as PNG")}
            aria-label={t("Export as PNG")}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: exporting ? "var(--text-dim)" : "var(--text-muted)",
              cursor: exporting ? "wait" : "pointer",
              flexShrink: 0,
              transition: "background 0.12s",
            }}
          >
            {exporting ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                style={{ animation: "spin 0.8s linear infinite" }}
                aria-hidden="true"
              >
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
          </button>
          <button
            onClick={onClose}
            title={t("Close")}
            aria-label={t("Close")}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 14,
              flexShrink: 0,
              transition: "background 0.12s",
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable message body — ref'd so the export can clone exactly
            this region and re-render it as a standalone card. */}
        <div
          ref={bodyRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "20px 24px 28px 24px",
            background: "var(--bg)",
          }}
        >
          <MessageView message={message} entryId={entryId} />
        </div>
      </div>
    </div>
  );
}

/**
 * Full-screen modal for a compaction entry. Renders the kernel's summary
 * (the `summary` string from the JSONL `compaction` entry) plus the
 * metadata the kernel stores alongside it: tokens before, the first kept
 * entry id, and the usage of the summarization call.
 *
 * Same chrome as BranchMessageViewer (backdrop click / Esc to close) but
 * no PNG export — the summary is a raw string, not a message bubble.
 */
function CompactionSummaryView({
  entry,
  onClose,
}: {
  entry: CompactionEntry;
  onClose: () => void;
}) {
  const { t } = useI18n();

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc to close (same skip-for-inputs rule as BranchMessageViewer).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const editable = document.activeElement?.getAttribute("contenteditable");
      if (editable === "true" || editable === "") return;
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const tokenStr = entry.tokensBefore.toLocaleString();
  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "";
  // `details` on disk is `{ readFiles, modifiedFiles }` for pi-generated
  // entries (extension-generated ones carry arbitrary payloads). Parse it
  // defensively so the footer never crashes on a malformed/unknown shape.
  const details =
    entry.details && typeof entry.details === "object" && !Array.isArray(entry.details)
      ? (entry.details as CompactionEntryDetails)
      : undefined;
  const readFiles = Array.isArray(details?.readFiles) ? details.readFiles : [];
  const modifiedFiles = Array.isArray(details?.modifiedFiles) ? details.modifiedFiles : [];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(880px, 100%)",
          maxHeight: "calc(100vh - 64px)",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              style={{
                color: "var(--accent)",
                fontSize: 12,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              [compaction]
            </span>
            <span style={{ color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>
              {t("Compacted from {n} tokens", { n: tokenStr })}
            </span>
            {ts && (
              <span style={{ color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>
                · {ts}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            title={t("Close")}
            aria-label={t("Close")}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 14,
              flexShrink: 0,
              transition: "background 0.12s",
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body — the raw summary rendered as Markdown, then
            metadata rows. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "20px 24px 28px 24px",
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre({ children }) {
                return <>{children}</>;
              },
              code({ className, children }) {
                const raw = String(children ?? "");
                if (className?.includes("language-") || raw.includes("\n")) {
                  return (
                    <pre
                      style={{
                        background: "var(--bg-selected)",
                        padding: "10px 12px",
                        borderRadius: 6,
                        overflow: "auto",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--text)",
                        lineHeight: 1.5,
                      }}
                    >
                      <code className={className}>{children}</code>
                    </pre>
                  );
                }
                return (
                  <code
                    style={{
                      background: "var(--bg-selected)",
                      padding: "1px 4px",
                      borderRadius: 3,
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.9em",
                      color: "var(--accent)",
                    }}
                  >
                    {children}
                  </code>
                );
              },
            }}
          >
            {entry.summary}
          </ReactMarkdown>

          {/* Metadata footer */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "10px 12px",
              background: "var(--bg-subtle)",
              borderRadius: 6,
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div>
              tokensBefore: {tokenStr}
            </div>
            <div>firstKeptEntryId: {entry.firstKeptEntryId}</div>
            {entry.usage && (
              <div>
                summary usage: {entry.usage.input} in / {entry.usage.output} out /{" "}
                {entry.usage.cacheRead} cacheRead / {entry.usage.cacheWrite} cacheWrite
              </div>
            )}
            {(readFiles.length > 0 || modifiedFiles.length > 0) && (
              <div>
                {readFiles.length > 0 && <div>read: {readFiles.join(", ")}</div>}
                {modifiedFiles.length > 0 && <div>modified: {modifiedFiles.join(", ")}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
