"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock";
import { EchartsBlock } from "./EchartsBlock";
import { SvgBlock } from "./SvgBlock";
import { CodeBlock } from "./CodeBlock";

export interface MarkdownContentProps {
  /** Markdown source to render. */
  content: string;
  /**
   * Resolve a relative `img` src to a servable URL. Each surface owns its own
   * data source (notes resolve against the note's directory via the notes
   * media route), so it is passed in rather than guessed here. Defaults to
   * identity — the browser then resolves the src against the page URL.
   */
  resolveImage?: (src: string) => string;
}

/**
 * Read-only Markdown renderer shared by the notes preview and the plans
 * preview: pi-work's custom blocks (code / mermaid / svg / echarts) plus GFM.
 * The chat message body has its own richer pipeline; this is the lighter
 * "document preview" variant, and the `resolveImage` seam is what lets each
 * document type point relative images at the right place.
 */
export function MarkdownContent({ content, resolveImage }: MarkdownContentProps) {
  const components = useMemo(() => {
    const resolve = resolveImage ?? ((src: string) => src);
    return {
      code({
        className,
        children,
        ...props
      }: {
        className?: string;
        children?: React.ReactNode;
      } & React.HTMLAttributes<HTMLElement>) {
        const lang = className?.replace("language-", "") ?? "";
        const raw = String(children ?? "");
        const isBlock = className?.includes("language-") || raw.includes("\n");
        if (isBlock) {
          if (lang === "mermaid") return <MermaidBlock key={raw} code={raw.replace(/\n$/, "")} />;
          if (lang === "svg") return <SvgBlock key={raw} code={raw.replace(/\n$/, "")} />;
          if (lang === "echarts") return <EchartsBlock key={raw} code={raw.replace(/\n$/, "")} />;
          return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
        }
        return (
          <code
            style={{
              background: "var(--bg-subtle)",
              padding: "1px 4px",
              borderRadius: 3,
              fontFamily: "var(--font-mono)",
              fontSize: "0.9em",
              color: "var(--accent-hover)",
            }}
            {...props}
          >
            {children}
          </code>
        );
      },
      pre({ children }: { children?: React.ReactNode }) {
        return <>{children}</>;
      },
      img: (props: { src?: string | Blob; alt?: string }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={props.src && typeof props.src === "string" ? resolve(props.src) : undefined}
          alt={props.alt ?? ""}
          style={{ maxWidth: "100%", borderRadius: 6 }}
          loading="lazy"
        />
      ),
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props} target="_blank" rel="noreferrer noopener" />
      ),
    };
  }, [resolveImage]);

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
