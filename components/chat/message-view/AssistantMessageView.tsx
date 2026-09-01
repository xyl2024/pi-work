"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { useImageLightbox } from "@/hooks/useImageLightbox";
import { useToast } from "../../ui/Toast";
import { exportMessageAsPng, MESSAGE_ACTION_ROW_CLASS } from "@/lib/client/export-message-card";
import { copyText } from "@/lib/client/clipboard";
import { Tooltip } from "../../ui/Tooltip";
import { MorphToggleIcon } from "../../ui/MorphToggleIcon";
import { extractImageGallery, type ImageItem } from "@/components/renderers/ImageLightbox";
import { ReadFileChips } from "../ReadFileChips";
import { COPY, CHECK, THUMBS_UP, HEART } from "@/lib/client/icon-paths";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "../../ui/ProviderIcon";
import { BlockView } from "./blocks";
import { formatTime, TurnDuration, UsageIcons } from "./utils";
import type { AssistantMessage, ToolResultMessage, TextContent, ThinkingContent, ToolCallContent, ReadFileInfo } from "@/lib/shared/types";

interface AssistantMessageViewProps {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
  showTimestamp?: boolean;
  keywords?: string[];
  isSearchMatch?: boolean;
  afterContent?: React.ReactNode;
  turnDuration?: { startMs: number; endMs?: number; running?: boolean };
  readFiles?: ReadFileInfo[];
  onOpenFile?: (filePath: string, fileName: string) => void;
  cwd?: string | null;
  sessionId?: string;
  entryId?: string;
}

function AssistantMessageViewInner({
  message,
  isStreaming,
  toolResults,
  modelNames,
  modelIcons,
  showTimestamp,
  keywords,
  isSearchMatch,
  afterContent,
  turnDuration,
  readFiles,
  onOpenFile,
  cwd,
}: AssistantMessageViewProps) {
  const { t } = useI18n();
  const toast = useToast();
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blocks = useMemo(() => message.content ?? [], [message.content]);
  const gallery = useMemo<ImageItem[]>(() => {
    const out: ImageItem[] = [];
    for (const block of blocks) {
      if (block.type === "text" || block.type === "thinking") {
        const markdown = block.type === "text" ? block.text : block.thinking;
        for (const item of extractImageGallery(markdown)) {
          if (!out.some((entry) => entry.src === item.src)) out.push(item);
        }
      }
    }
    return out;
  }, [blocks]);
  const lightbox = useImageLightbox(gallery);
  const [hovered, setHovered] = useState(false);
  const [copied, flashCopied] = useTransientFlag();
  const [liked, setLiked] = useState(false);
  const [heartShown, setHeartShown] = useState(false);
  const heartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exporting, setExporting] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const textContent = useMemo(
    () => blocks
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("\n"),
    [blocks],
  );
  const copyableContent = useMemo(
    () => textContent || blocks
      .map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "thinking") return block.thinking;
        if (block.type === "toolCall") return `${block.toolName}(${JSON.stringify(block.input ?? {})})`;
        return "";
      })
      .filter(Boolean)
      .join("\n"),
    [blocks, textContent],
  );
  // Estimated chars while streaming — extracted out of the JSX IIFE so
  // it doesn't run on every render (only when blocks grow / streaming
  // flag flips).
  const streamChars = useMemo(() => {
    if (!isStreaming) return 0;
    let chars = 0;
    for (const block of blocks) {
      if (block.type === "text") chars += (block as TextContent).text?.length ?? 0;
      else if (block.type === "thinking") chars += (block as ThinkingContent).thinking?.length ?? 0;
      else if (block.type === "toolCall") chars += JSON.stringify((block as ToolCallContent).input ?? {}).length;
    }
    return chars;
  }, [isStreaming, blocks]);

  const copyContent = () => {
    copyText(copyableContent)
      .then(() => {
        flashCopied();
      })
      .catch(() => {
        console.warn("clipboard write failed");
      });
  };

  const toggleLike = () => {
    if (liked) {
      if (heartTimerRef.current) {
        clearTimeout(heartTimerRef.current);
        heartTimerRef.current = null;
      }
      setLiked(false);
      setHeartShown(false);
    } else {
      setLiked(true);
      setHeartShown(true);
      heartTimerRef.current = setTimeout(() => {
        setHeartShown(false);
        heartTimerRef.current = null;
      }, 700);
    }
  };

  useEffect(() => () => {
    if (heartTimerRef.current) clearTimeout(heartTimerRef.current);
  }, []);

  const handleExport = async () => {
    const element = messageRef.current;
    if (!element || exporting) return;
    setExporting(true);
    try {
      await exportMessageAsPng(element, "20px 24px 28px");
      toast.show({ kind: "success", message: t("Message card exported") });
    } catch (error) {
      console.warn("export message failed:", error);
      toast.show({ kind: "error", message: t("Failed to export image") });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!isStreaming) {
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const currentBlocks = blocksRef.current;
      const now = Date.now();

      let chars = 0;
      for (const block of currentBlocks) {
        if (block.type === "text") chars += (block as TextContent).text?.length ?? 0;
        else if (block.type === "thinking") chars += (block as ThinkingContent).thinking?.length ?? 0;
        else if (block.type === "toolCall") chars += JSON.stringify((block as ToolCallContent).input ?? {}).length;
      }
      if (chars === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) {
        const next = chars / 4 / elapsed;
        // Skip the re-render when the rounded value is unchanged (tps is
        // displayed with one decimal). With a 300 ms tick this often
        // avoids 1-2 redundant renders per second during streaming.
        setTps((prev) => (prev !== null && Math.abs(prev - next) < 0.05 ? prev : next));
      }
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  return (
    <div
      ref={messageRef}
      style={{ marginBottom: 16 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          fontSize: 13,
          color: "var(--text-dim)",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {message.provider && (
          <>
            <ProviderIcon id={resolveProviderIcon(message.provider, message.model, modelIcons) ?? ""} size={16} fallback={<ProviderGearIcon size={16} />} />
            <span>{modelNames?.[`${message.provider}:${message.model}`] ?? modelNames?.[message.model] ?? message.model}</span>
          </>
        )}
        {isStreaming && (() => {
          const est = Math.round(streamChars / 4);
          return (
            <>
              {est > 0 && (
                <Tooltip content={t("Estimated tokens while streaming")}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 400 }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                      </svg>
                      {est}
                    </span>
                    {tps !== null && (() => {
                      const bg = tps >= 50 ? "#53b3cb" : tps >= 30 ? "#9bc53d" : tps >= 15 ? "#f9c22e" : "#e01a4f";
                      return (
                        <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: bg, color: "#fff", fontSize: 11, fontWeight: 400 }}>
                          {tps.toFixed(1)} t/s
                        </span>
                      );
                    })()}
                  </span>
                </Tooltip>
              )}
            </>
          );
        })()}
      </div>

      {!isStreaming && message.stopReason === "error" && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid rgba(248,113,113,0.45)",
            background: "rgba(248,113,113,0.06)",
            color: "#f87171",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            marginBottom: 8,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {t("Error")}: {message.errorMessage ?? t("Model call failed")}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map((block, index) => (
          <BlockView key={index} block={block} toolResults={toolResults} isStreaming={isStreaming} isLast={index === blocks.length - 1} keywords={keywords} isSearchMatch={isSearchMatch} onImageClick={lightbox.openAt} cwd={cwd} />
        ))}
      </div>

      {afterContent}

      <div className={MESSAGE_ACTION_ROW_CLASS} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        {!isStreaming && (
          <Tooltip content={t("Copy message")}>
            <button
              onClick={copyContent}
              aria-label={t("Copy message")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                padding: 0,
                background: "none",
                border: "none",
                borderRadius: 5,
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <MorphToggleIcon from={COPY} to={CHECK} active={copied} size={11} strokeWidth={1.8} />
            </button>
          </Tooltip>
        )}
        {!isStreaming && (
          <Tooltip content={t("Share this message card")}>
            <button
              onClick={handleExport}
              disabled={exporting}
              aria-label={t("Share this message card")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                padding: 0,
                background: "none",
                border: "none",
                borderRadius: 5,
                color: "var(--text-dim)",
                cursor: exporting ? "wait" : "pointer",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {exporting ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true">
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              )}
            </button>
          </Tooltip>
        )}
        {!isStreaming && (
          <Tooltip content={liked ? t("Unlike") : t("Like")}>
            <button
              onClick={toggleLike}
              aria-label={liked ? t("Unlike") : t("Like")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                padding: 0,
                background: "none",
                border: "none",
                borderRadius: 5,
                color: liked ? "#f472b6" : "var(--text-dim)",
                cursor: "pointer",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { if (!liked) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!liked) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <MorphToggleIcon from={THUMBS_UP} to={HEART} active={heartShown} size={11} strokeWidth={1.8} />
            </button>
          </Tooltip>
        )}
        {turnDuration && (turnDuration.endMs !== undefined || turnDuration.running) && (
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
            <TurnDuration startMs={turnDuration.startMs} endMs={turnDuration.endMs} running={!!turnDuration.running} />
          </span>
        )}
        {readFiles && readFiles.length > 0 && onOpenFile && (
          <ReadFileChips files={readFiles} onOpenFile={onOpenFile} />
        )}
        {!isStreaming && (message.usage || time) && (
          <span style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 0.12s",
          }}>
            {message.usage && <UsageIcons usage={message.usage} />}
            {time && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{time}</span>}
          </span>
        )}
      </div>
      {lightbox.lightbox}
    </div>
  );
}

/**
 * `message` is the heavy prop. For historical entries it's stable, so
 * the default shallow memo short-circuits the surrounding re-renders
 * that flow through ChatWindowContent when the streaming store ticks.
 * The streaming bubble intentionally re-renders on every snapshot
 * flip (it lives outside the memoized boundary in StreamingBubble),
 * so memo here is the safety net for *historical* messages.
 *
 * `afterContent` and `toolResults` are caller-owned React/Map refs;
 * callers that want to avoid extra renders should pass stable refs
 * (which ChatWindow already does — toolResults only changes when an
 * in-flight tool result actually changes).
 */
export const AssistantMessageView = memo(AssistantMessageViewInner);
AssistantMessageView.displayName = "AssistantMessageView";
