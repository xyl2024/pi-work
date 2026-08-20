"use client";

import type { ReactElement } from "react";
import { iconBtnStyle, emptyStyle } from "./styles";
import { relativeTime } from "./relativeTime";
import type { RssFeed } from "@/lib/rss/schema";

interface FeedsViewProps {
  feeds: RssFeed[];
  isLoading: boolean;
  onOpen: (feedId: string) => void;
  onRefresh: (feedId: string) => void | Promise<void>;
  onDelete: (feedId: string) => void | Promise<void>;
  t: (k: string) => string;
}

/**
 * Feed list view. Each row shows the feed title (or URL as fallback),
 * an unread badge, the last-fetched relative timestamp, and a
 * refresh / delete button pair. Clicking the row body navigates to
 * the articles view; the buttons stop propagation so they don't
 * double-fire navigation.
 */
export function FeedsView({
  feeds,
  isLoading,
  onOpen,
  onRefresh,
  onDelete,
  t,
}: FeedsViewProps): ReactElement {
  if (feeds.length === 0) {
    return (
      <div style={emptyStyle}>
        {isLoading ? "Loading…" : t("No feeds yet — click + to add one.")}
      </div>
    );
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {feeds.map((feed) => (
        <li
          key={feed.id}
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
          onClick={() => onOpen(feed.id)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                flex: 1,
                fontWeight: 500,
                fontSize: 13,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {feed.title || feed.url}
            </div>
            {feed.unreadCount > 0 && (
              <span
                style={{
                  background: "var(--accent)",
                  color: "var(--bg)",
                  borderRadius: 8,
                  padding: "1px 6px",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {feed.unreadCount}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1, whiteSpace: "nowrap" }}>
              {feed.lastFetchedAt
                ? `${t("Last fetched")}: ${relativeTime(feed.lastFetchedAt, t("Never"))}`
                : t("Never fetched")}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void onRefresh(feed.id);
              }}
              style={iconBtnStyle}
              title={t("Refresh")}
            >
              ↻
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void onDelete(feed.id);
              }}
              style={iconBtnStyle}
              title={t("Delete feed")}
            >
              ✕
            </button>
          </div>
          {feed.lastError && (
            <div
              style={{
                fontSize: 11,
                color: "#e55",
              }}
              title={feed.lastError}
            >
              ⚠ {feed.lastError}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
