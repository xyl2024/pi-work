"use client";

import { useEffect, useMemo } from "react";
import type { AgentMessage, SessionTreeNode } from "@/lib/types";
import { MessageView } from "./MessageView";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  /** The clicked card's entry id — used to look up the one message this card represents. */
  entryId: string;
  /** Full session tree (roots). Walked to find the entry by id. */
  branchTree: SessionTreeNode[];
  onClose: () => void;
}

/**
 * Find the single AgentMessage that the clicked card represents. The
 * conversation-tree panel only ever emits user/assistant cards (see
 * `buildConversationTree`), so a defensive role check is enough — anything
 * else (toolResult / etc.) renders nothing and closes cleanly.
 */
function findMessage(
  entryId: string,
  roots: SessionTreeNode[],
): { message: AgentMessage; timestamp: string } | null {
  const stack: SessionTreeNode[] = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.entry.id === entryId && node.entry.type === "message") {
      return { message: node.entry.message, timestamp: node.entry.timestamp };
    }
    // Push in reverse so the leftmost child is popped first; matters only
    // when an id happens to be reused, which shouldn't happen but keeps
    // the walk order predictable.
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]);
    }
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

  const data = useMemo(
    () => findMessage(entryId, branchTree),
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

        {/* Scrollable message body */}
        <div
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
