"use client";

import { useMemo, type ReactElement } from "react";
import parseHtml, { domToReact, type DOMNode, type Element, type HTMLReactParserOptions } from "html-react-parser";
import { emptyStyle } from "./styles";
import { relativeTime } from "./relativeTime";
import { sanitizeRssHtml } from "@/lib/shared/rss/sanitize";
import { extractImagesFromHtml, type ImageItem } from "@/components/renderers/ImageLightbox";
import { useImageLightbox } from "@/hooks/useImageLightbox";
import { SmartImage } from "@/components/ui/SmartImage";
import type { RssArticle } from "@/lib/shared/rss/schema";

interface ReaderViewProps {
  article: RssArticle | null;
  t: (k: string) => string;
}

/**
 * Single-article reader. Sanitizes the article HTML at render time
 * (the store keeps raw HTML), pulls every <img> out so the user can
 * open any one in a full-screen lightbox, and rewrites every <a> to
 * target="_blank" so article links never replace the Pi Web session.
 */
export function ReaderView({ article, t }: ReaderViewProps): ReactElement {
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
  const lightbox = useImageLightbox(images);

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
            lightbox.openAt(src);
          }}
        />
      );
    },
  }), [lightbox]);

  if (!article) {
    return <div style={emptyStyle}>{t("Article not found")}</div>;
  }

  return (
    <div style={{ padding: "12px 16px", fontSize: 13, lineHeight: 1.55 }}>
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
      {lightbox.lightbox}
    </div>
  );
}
