"use client";

import { useMemo, useState, type ReactElement } from "react";
import parseHtml, { domToReact, type DOMNode, type Element, type HTMLReactParserOptions } from "html-react-parser";
import { iconBtnStyle, emptyStyle } from "./styles";
import { relativeTime } from "./relativeTime";
import { sanitizeRssHtml } from "@/lib/shared/rss/sanitize";
import { ImageLightbox, extractImagesFromHtml, type ImageItem } from "@/components/renderers/ImageLightbox";
import { SmartImage } from "@/components/ui/SmartImage";
import type { RssArticle, RssFeed } from "@/lib/shared/rss/schema";

interface ReaderViewProps {
  feed: RssFeed;
  article: RssArticle | null;
  onBack: () => void;
  t: (k: string) => string;
}

/**
 * Single-article reader. Sanitizes the article HTML at render time
 * (the store keeps raw HTML), pulls every <img> out so the user can
 * open any one in a full-screen lightbox, and rewrites every <a> to
 * target="_blank" so article links never replace the Pi Web session.
 */
export function ReaderView({ feed, article, onBack, t }: ReaderViewProps): ReactElement {
  const safeHtml = useMemo(() => sanitizeRssHtml(article?.contentHtml ?? ""), [
    article?.contentHtml,
  ]);

  // Pull every <img> out of the sanitized HTML so the user can open any
  // one in the full-screen lightbox and navigate prev/next within the
  // article's gallery. DOMParser is browser-only, so this runs at render
  // time on the client.
  const images = useMemo<ImageItem[]>(
    () => (safeHtml ? extractImagesFromHtml(safeHtml) : []),
    [safeHtml],
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const parseOptions = useMemo<HTMLReactParserOptions>(() => ({
    replace: (node: DOMNode) => {
      if (node.type !== "tag") return undefined;
      const el = node as Element;
      if (el.name === "a") {
        // Force every link to open in a new tab so article navigation
        // never replaces the Pi Web session in the current tab.
        return (
          <a
            href={el.attribs?.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {domToReact(el.children as DOMNode[])}
          </a>
        );
      }
      if (el.name !== "img") return undefined;
      const src = el.attribs?.src;
      if (!src) return undefined;
      const idx = images.findIndex((it) => it.src === src);
      if (idx === -1) return undefined;
      return (
        <SmartImage
          src={src}
          alt={el.attribs?.alt ?? ""}
          loading="lazy"
          loaderSize={96}
          style={{ cursor: "zoom-in" }}
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setLightboxIndex(idx);
          }}
        />
      );
    },
  }), [images]);

  if (!article) {
    return <div style={emptyStyle}>{t("Article not found")}</div>;
  }

  return (
    <div style={{ padding: "12px 16px", fontSize: 13, lineHeight: 1.55 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <button type="button" onClick={onBack} style={iconBtnStyle}>
          ←
        </button>
        <div style={{ fontSize: 11, color: "var(--text-muted)", flex: 1 }}>
          {feed.title ?? feed.url}
        </div>
        {article.link && (
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            {t("Open original")} ↗
          </a>
        )}
      </div>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          margin: "0 0 6px",
          color: "var(--text)",
        }}
      >
        {article.title ?? t("untitled")}
      </h2>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16 }}>
        {relativeTime(article.pubDate ?? article.fetchedAt, "")}
      </div>
      <div
        className="rss-reader-body"
        style={{ color: "var(--text)" }}
      >
        {safeHtml ? parseHtml(safeHtml, parseOptions) : null}
      </div>
      {lightboxIndex !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}
