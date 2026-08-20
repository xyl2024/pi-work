"use client";

import type { ReactElement } from "react";
import { iconBtnStyle, emptyStyle } from "./styles";
import { relativeTime } from "./relativeTime";
import type { RssArticle, RssFeed } from "@/lib/rss-schema";

interface ArticlesViewProps {
  feed: RssFeed | null;
  articles: RssArticle[];
  onOpen: (articleId: string) => void;
  onMarkAll: () => void | Promise<void>;
  t: (k: string) => string;
}

/**
 * Article list for one feed. Shows a "Mark all as read" affordance
 * only when at least one article is unread. Each row marks unread
 * items with a leading dot and a slightly bolder title.
 */
export function ArticlesView({
  feed,
  articles,
  onOpen,
  onMarkAll,
  t,
}: ArticlesViewProps): ReactElement {
  if (!feed) {
    return <div style={emptyStyle}>{t("Feed not found")}</div>;
  }
  const hasUnread = articles.some((a) => a.readAt === null);
  return (
    <>
      {hasUnread && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
          }}
        >
          <button
            type="button"
            onClick={() => void onMarkAll()}
            style={{
              ...iconBtnStyle,
              fontSize: 12,
              padding: "4px 10px",
            }}
          >
            {t("Mark all as read")}
          </button>
        </div>
      )}
      {articles.length === 0 ? (
        <div style={emptyStyle}>{t("No articles yet")}</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {articles.map((article) => {
            const isUnread = article.readAt === null;
            const ts = article.pubDate ?? article.fetchedAt;
            return (
              <li
                key={article.id}
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
                onClick={() => onOpen(article.id)}
              >
                {isUnread && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--accent)",
                      flexShrink: 0,
                      marginTop: 5,
                    }}
                  />
                )}
                {!isUnread && <span style={{ width: 8, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: isUnread ? 600 : 400,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {article.title ?? t("untitled")}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {relativeTime(ts, t("Never"))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
