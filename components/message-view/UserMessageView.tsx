"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useCollapseHeight } from "@/hooks/useCollapseHeight";
import { Tooltip } from "../Tooltip";
import { copyText } from "../CodeBlock";
import { SmartImage } from "../SmartImage";
import { ImageLightbox, type ImageItem } from "../ImageLightbox";
import { highlightKeywords, formatTime } from "./utils";
import type { ImageContent, UserMessage } from "@/lib/types";

const COLLAPSED_USER_MSG_HEIGHT = 240;
const BUBBLE_VERTICAL_EXTRA = 18;

export function UserMessageView({ message, isFocused, onNavigate, prevAssistantEntryId, onEditContent, keywords, isSearchMatch }: {
  message: UserMessage;
  isFocused?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  keywords?: string[];
  isSearchMatch?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [avatarOk, setAvatarOk] = useState(true);
  const [avatarCacheKey] = useState(() => `${Date.now()}`);
  const [expanded, setExpanded] = useState(false);
  const { contentRef, contentHeight, allowAnim } = useCollapseHeight<HTMLDivElement>();
  const isOpen = expanded || !!isFocused;
  const naturalHeight = contentHeight === null ? "auto" : contentHeight + BUBBLE_VERTICAL_EXTRA;
  const showExpandMask = contentHeight !== null && contentHeight + BUBBLE_VERTICAL_EXTRA > COLLAPSED_USER_MSG_HEIGHT;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { username?: string | null } | null) => {
        if (!cancelled && data && typeof data.username === "string") setUsername(data.username);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((block): block is ImageContent => block.type === "image");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageGallery: ImageItem[] = imageBlocks.map((image) => {
    const flat = image as unknown as { data?: string; mimeType?: string };
    const src = image.source
      ? image.source.type === "base64"
        ? `data:${image.source.media_type};base64,${image.source.data}`
        : image.source.url ?? ""
      : flat.data
        ? `data:${flat.mimeType};base64,${flat.data}`
        : "";
    return { alt: "", src };
  });

  const time = formatTime(message.timestamp);
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;
  const hasMetadata = !!time || canNavigate || !!content;

  const copyContent = () => {
    copyText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const avatarSrc = `/api/profile/avatar?k=${encodeURIComponent(avatarCacheKey)}`;

  return (
    <div
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
        <div
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: "50%",
            overflow: "hidden",
            background: "var(--bg-hover)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border)",
          }}
        >
          {avatarOk && (
            <SmartImage
              key={avatarSrc}
              src={avatarSrc}
              alt=""
              onError={() => setAvatarOk(false)}
              loaderSize={14}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
          {!avatarOk && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--text-muted)" }}
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
        </div>
        <span>{username ?? t("You")}</span>
      </div>

      {(imageBlocks.length > 0 || content) && (
        <div
          style={{
            position: "relative",
            background: "var(--user-bg)",
            border: "1px solid rgba(59,130,246,0.2)",
            borderRadius: 12,
            padding: "8px 12px",
            height: isOpen ? naturalHeight : (contentHeight === null ? "auto" : Math.min(contentHeight + BUBBLE_VERTICAL_EXTRA, COLLAPSED_USER_MSG_HEIGHT)),
            overflow: "hidden",
            transition: allowAnim ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
          }}
        >
          <div ref={contentRef}>
            {imageBlocks.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
                {imageBlocks.map((image, index) => {
                  const flat = image as unknown as { data?: string; mimeType?: string };
                  const src = image.source
                    ? image.source.type === "base64"
                      ? `data:${image.source.media_type};base64,${image.source.data}`
                      : image.source.url ?? ""
                    : flat.data
                      ? `data:${flat.mimeType};base64,${flat.data}`
                      : "";
                  return (
                    <Tooltip key={index} content={t("Click to expand")}>
                      <span
                        onClick={() => {
                          const idx = imageGallery.findIndex((item) => item.src === src);
                          if (idx >= 0) setLightboxIndex(idx);
                        }}
                        style={{ display: "inline-flex", cursor: "zoom-in" }}
                      >
                        <SmartImage
                          src={src}
                          alt=""
                          loaderSize={96}
                          style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, objectFit: "contain", display: "block", border: "1px solid var(--border)" }}
                        />
                      </span>
                    </Tooltip>
                  );
                })}
              </div>
            )}

            {content && (
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--text)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {highlightKeywords(content, keywords, isSearchMatch)}
              </div>
            )}
          </div>

          {!isOpen && showExpandMask && (
            <button
              onClick={() => setExpanded(true)}
              aria-label={t("Expand")}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                border: "none",
                padding: 0,
                background: "linear-gradient(to bottom, rgba(0,0,0,0), var(--user-bg))",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--text-muted)" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      )}

      {hasMetadata && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          {content && (
            <div style={{ display: "flex", gap: 3 }}>
              <Tooltip content={t("Copy message")}>
                <button
                  onClick={copyContent}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    height: 22,
                    background: "none",
                    border: "none",
                    borderRadius: 5,
                    color: copied ? "var(--accent)" : "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  {copied ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                  {copied ? t("Copied") : t("Copy")}
                </button>
              </Tooltip>
            </div>
          )}
          {canNavigate && (
            <div style={{ display: "flex", gap: 3 }}>
              <Tooltip content={t("Start a new session branch from this message")}>
                <button
                  onClick={() => { onNavigate!(prevAssistantEntryId!); onEditContent?.(content); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    height: 22,
                    background: "none",
                    border: "none",
                    borderRadius: 5,
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="11" height="11">
                    <path fillRule="evenodd" clipRule="evenodd" d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z" fill="currentColor"></path>
                  </svg>
                  {t("Start new branch")}
                </button>
              </Tooltip>
            </div>
          )}
          {showExpandMask && isOpen && (
            <div style={{ display: "flex", gap: 3 }}>
              <Tooltip content={t("Collapse message")}>
                <button
                  onClick={() => setExpanded(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    height: 22,
                    background: "none",
                    border: "none",
                    borderRadius: 5,
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 15 12 9 18 15" />
                  </svg>
                  {t("Collapse message")}
                </button>
              </Tooltip>
            </div>
          )}
          {time && <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto", opacity: hovered ? 1 : 0, transition: "opacity 0.12s" }}>{time}</span>}
        </div>
      )}
      {lightboxIndex !== null && imageGallery.length > 0 && (
        <ImageLightbox
          images={imageGallery}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}
