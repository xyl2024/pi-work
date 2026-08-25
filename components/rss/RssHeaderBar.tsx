"use client";

import type { ReactElement } from "react";
import { iconBtnStyle } from "./styles";
import { RefreshIconButton } from "../ui/RefreshIconButton";
import { ArrowLeftIcon, ExternalLinkIcon, PlusIcon } from "../ui/icons/primitives";
import type { RssView } from "@/hooks/useRss";

interface RssHeaderBarProps {
  view: RssView;
  feedTitle: string | null;
  articleLink: string | null;
  navigate: (next: RssView) => void;
  onAdd: () => void;
  onRefreshAll: () => void;
  adding: boolean;
  cancelAdd: () => void;
  newUrl: string;
  setNewUrl: (v: string) => void;
  submitting: boolean;
  onSubmitAdd: () => void;
  t: (k: string) => string;
}

/**
 * Top bar of the RSS panel. Hosts the title + back/refresh/add buttons
 * and the inline "Add feed" form (shown when `adding` is true). The
 * parent (`RssPanel`) owns the `adding` / `newUrl` / `submitting` state
 * so the form submission can run hooks (`useRss().addFeed`, `useToast`).
 */
export function RssHeaderBar({
  view,
  feedTitle,
  articleLink,
  navigate,
  onAdd,
  onRefreshAll,
  adding,
  cancelAdd,
  newUrl,
  setNewUrl,
  submitting,
  onSubmitAdd,
  t,
}: RssHeaderBarProps): ReactElement {
  const backLabel =
    view.kind === "reader"
      ? t("Back to articles")
      : view.kind === "articles"
        ? t("Back to feeds")
        : null;
  const titleLabel =
    view.kind === "feeds"
      ? t("RSS feeds")
      : view.kind === "articles"
        ? feedTitle ?? t("Articles")
        : feedTitle ?? t("Articles");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
        }}
      >
        {backLabel && (
          <button
            type="button"
            onClick={() => {
              if (view.kind === "reader") {
                navigate({ kind: "articles", feedId: view.feedId });
              } else if (view.kind === "articles") {
                navigate({ kind: "feeds" });
              }
            }}
            className="rss-icon-button"
            style={iconBtnStyle}
            aria-label={backLabel}
          >
            <ArrowLeftIcon size={16} />
          </button>
        )}
        <div
          style={{
            flex: 1,
            fontWeight: 600,
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {titleLabel}
        </div>
        {view.kind === "feeds" && (
          <RefreshIconButton
            onClick={onRefreshAll}
            label={t("Refresh all")}
            style={{ marginRight: 0 }}
          />
        )}
        {view.kind === "reader" && articleLink && (
          <a
            href={articleLink}
            target="_blank"
            rel="noopener noreferrer"
            className="rss-header-link"
            aria-label={t("Open original")}
          >
            <ExternalLinkIcon size={14} />
            <span>{t("Open original")}</span>
          </a>
        )}
        {view.kind === "feeds" && (
          <button type="button" onClick={onAdd} className="rss-icon-button" style={iconBtnStyle} aria-label={t("Add RSS feed")}>
            <PlusIcon size={16} />
          </button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmitAdd();
          }}
          style={{
            display: "flex",
            gap: 6,
            padding: "0 12px 8px",
          }}
        >
          <input
            autoFocus
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text)",
              padding: "4px 8px",
              fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={submitting || newUrl.trim().length === 0}
            style={{
              ...iconBtnStyle,
              width: "auto",
              height: "auto",
              padding: "4px 10px",
              opacity: submitting || newUrl.trim().length === 0 ? 0.5 : 1,
            }}
          >
            {t("Add")}
          </button>
          <button
            type="button"
            onClick={cancelAdd}
            style={{ ...iconBtnStyle, width: "auto", height: "auto", padding: "4px 10px" }}
          >
            {t("Cancel")}
          </button>
        </form>
      )}
    </div>
  );
}
