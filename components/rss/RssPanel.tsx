"use client";

/**
 * Right-panel tab body for the RSS feature.
 *
 * Single-column layout that switches between three views, owned by
 * `useRss().view`:
 *
 *   - feeds:    list of subscribed feeds with unread badges + per-row actions
 *   - articles: article list for one feed, sorted newest first
 *   - reader:   single-article HTML viewer with a "Mark all as read" /
 *               "Open original" affordances
 *
 * State management, fetch, and view navigation live in `hooks/useRss.ts`.
 * Sanitization is `lib/rss-sanitize.ts` (DOMPurify, run at render time so the
 * store keeps the raw HTML).
 *
 * The per-view components live in `./RssPanel/*`:
 *   - RssHeaderBar.tsx  — top bar (title + back/refresh/add + add-form)
 *   - FeedsView.tsx     — feed list view
 *   - ArticlesView.tsx  — article list view
 *   - ReaderView.tsx    — single-article reader
 *   - relativeTime.ts   — short timestamp formatter
 *   - styles.ts         — shared `iconBtnStyle` / `emptyStyle`
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useRss } from "@/hooks/useRss";
import { clearRssScrollForFeed, flushRssScroll, scrollTopForView, setRssScroll } from "@/hooks/rssStore";
import { emptyStyle } from "./styles";
import { RssHeaderBar } from "./RssHeaderBar";
import { FeedsView } from "./FeedsView";
import { ArticlesView } from "./ArticlesView";
import { ReaderView } from "./ReaderView";

export function RssPanel(): ReactElement {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const rss = useRss();

  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Single scroll ancestor for all three views.
  const containerRef = useRef<HTMLDivElement>(null);

  // ── View + scroll persistence (see hooks/rssStore.ts) ─────────────────
  // Survives right-panel tab switches (module store) and full page refreshes
  // (localStorage hydration in useRssViewState).

  // Throttled scroll save: every scroll event queues the latest (view,
  // scrollTop); rssStore coalesces these into at most one localStorage write
  // per animation frame. `setRssView` itself flushes pending writes so a fast
  // scroll + immediate navigation never loses the previous view's position.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      setRssScroll(rss.view, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [rss.view]);

  // Restore scroll position after every view change AND after async article
  // loads complete. Runs in useLayoutEffect so the browser paints the
  // restored position in the same frame, avoiding a visible jump from 0 → N.
  // Guards against applying to a too-short container (e.g. during the brief
  // window between view change and articles load).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const target = scrollTopForView(rss.view);
    if (target === undefined || target === 0) return;
    if (el.scrollHeight <= el.clientHeight) return;
    el.scrollTop = target;
  }, [rss.view, rss.articlesByFeed]);

  // pagehide / visibilitychange flush so the LAST scroll write lands on disk
  // even if the user closes the tab while a throttled rAF is still in flight.
  useEffect(() => {
    const flush = () => flushRssScroll();
    window.addEventListener("pagehide", flush);
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Stale-data fallback: if the saved view points at a feed / article that
  // no longer exists (deleted from another tab, or article pruned server
  // side), bounce out with a one-shot toast and clean up orphaned scroll keys.
  useEffect(() => {
    const v = rss.view;
    if (v.kind === "feeds") return;
    if (rss.feeds.length === 0) return; // wait for the feed list to load
    if (!rss.feeds.some((f) => f.id === v.feedId)) {
      toast.show({
        kind: "info",
        message: t("This feed no longer exists, returning to feed list"),
      });
      rss.navigate({ kind: "feeds" });
      clearRssScrollForFeed(v.feedId);
      return;
    }
    if (v.kind === "reader") {
      const list = rss.articlesByFeed[v.feedId];
      // Only validate once the article list has been fetched at least once;
      // otherwise we'd bounce on every remount before the lazy load lands.
      if (list && !list.some((a) => a.id === v.articleId)) {
        toast.show({
          kind: "info",
          message: t("This article no longer exists, returning to article list"),
        });
        rss.navigate({ kind: "articles", feedId: v.feedId });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rss.view, rss.feeds, rss.articlesByFeed]);

  // When we land in the reader view, lazily ensure articles for that feed are
  // loaded so the cache is warm when the user clicks Back.
  useEffect(() => {
    const v = rss.view;
    if (v.kind === "articles" || v.kind === "reader") {
      if (!rss.articlesByFeed[v.feedId]) {
        void rss.loadArticles(v.feedId).catch(() => {
          /* error already captured by the hook */
        });
      }
    }
    // rss.loadArticles is stable from useCallback; rss as a whole changes
    // identity on every render and would re-fire this effect needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rss.view, rss.articlesByFeed, rss.loadArticles]);

  // Auto-mark read when entering the reader view.
  useEffect(() => {
    const v = rss.view;
    if (v.kind !== "reader") return;
    const articles = rss.articlesByFeed[v.feedId] ?? [];
    const article = articles.find((a) => a.id === v.articleId);
    if (article && article.readAt === null) {
      void rss.markArticleRead(article.id, true).catch(() => {
        /* swallow — the cache will sync on next refetch */
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rss.view, rss.articlesByFeed, rss.markArticleRead]);

  const handleAdd = useCallback(async () => {
    const url = newUrl.trim();
    if (!url) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      await rss.addFeed({ url });
      setNewUrl("");
      setAdding(false);
      toast.show({ kind: "success", message: t("Feed added") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: `${t("Failed to add feed")}: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setSubmitting(false);
    }
  }, [newUrl, rss, submitting, t, toast]);

  const handleRefreshAll = useCallback(async () => {
    if (rss.feeds.length === 0) {
      toast.show({ kind: "info", message: t("No feeds yet") });
      return;
    }
    await Promise.all(
      rss.feeds.map((f) =>
        rss.refreshFeed(f.id).catch(() => null),
      ),
    );
    toast.show({ kind: "success", message: t("Refreshed") });
  }, [rss, t, toast]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const view = rss.view;
  const feed =
    view.kind === "feeds"
      ? null
      : rss.feeds.find((f) => f.id === view.feedId) ?? null;
  const article =
    view.kind === "reader"
      ? (rss.articlesByFeed[view.feedId] ?? []).find(
          (a) => a.id === view.articleId,
        ) ?? null
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <RssHeaderBar
        view={rss.view}
        feedTitle={feed?.title ?? null}
        navigate={rss.navigate}
        onAdd={() => setAdding(true)}
        onRefreshAll={handleRefreshAll}
        adding={adding}
        cancelAdd={() => {
          setAdding(false);
          setNewUrl("");
        }}
        newUrl={newUrl}
        setNewUrl={setNewUrl}
        submitting={submitting}
        onSubmitAdd={handleAdd}
        t={t}
      />

      {adding && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          {t("Add feed URL")}
        </div>
      )}

      <div ref={containerRef} style={{ flex: 1, overflow: "auto", padding: "0 0 16px" }}>
        {rss.view.kind === "feeds" && (
          <FeedsView
            feeds={rss.feeds}
            isLoading={rss.isLoading}
            onOpen={(id) => rss.navigate({ kind: "articles", feedId: id })}
            onRefresh={async (id) => {
              try {
                const result = await rss.refreshFeed(id);
                if (result && !result.ok) {
                  toast.show({
                    kind: "error",
                    message: `${t("Refresh failed")}: ${result.error ?? ""}`,
                  });
                } else {
                  toast.show({ kind: "success", message: t("Refreshed") });
                }
              } catch (e) {
                toast.show({
                  kind: "error",
                  message: `${t("Failed to refresh feed")}: ${e instanceof Error ? e.message : String(e)}`,
                });
              }
            }}
            onDelete={async (id) => {
              const f = rss.feeds.find((x) => x.id === id);
              const ok = await confirm({
                title: t("Delete feed?"),
                description: f?.title ?? f?.url ?? "",
                destructive: true,
                confirmLabel: t("Delete"),
              });
              if (!ok) return;
              try {
                await rss.removeFeed(id);
                toast.show({ kind: "success", message: t("Feed deleted") });
              } catch (e) {
                toast.show({
                  kind: "error",
                  message: `${t("Failed to delete feed")}: ${e instanceof Error ? e.message : String(e)}`,
                });
              }
            }}
            t={t}
          />
        )}

        {view.kind === "articles" && (
          <ArticlesView
            feed={feed}
            articles={rss.articlesByFeed[view.feedId] ?? []}
            onOpen={(articleId) =>
              rss.navigate({ kind: "reader", feedId: view.feedId, articleId })
            }
            onMarkAll={async () => {
              if (!feed) return;
              try {
                await rss.markAllFeedRead(feed.id);
                toast.show({
                  kind: "success",
                  message: t("Marked all as read"),
                });
              } catch (e) {
                toast.show({
                  kind: "error",
                  message: `${t("Failed to mark articles as read")}: ${e instanceof Error ? e.message : String(e)}`,
                });
              }
            }}
            t={t}
          />
        )}

        {rss.view.kind === "reader" && feed && (
          <ReaderView
            feed={feed}
            article={article}
            onBack={() =>
              rss.navigate({ kind: "articles", feedId: feed.id })
            }
            t={t}
          />
        )}

        {rss.view.kind === "reader" && !feed && (
          <div style={emptyStyle}>{t("Feed not found")}</div>
        )}
      </div>
    </div>
  );
}
