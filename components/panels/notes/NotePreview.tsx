"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "@/components/renderers/MermaidBlock";
import { EchartsBlock } from "@/components/renderers/EchartsBlock";
import { SvgBlock } from "@/components/renderers/SvgBlock";
import { CodeBlock } from "@/components/renderers/CodeBlock";
import { noteMediaUrl } from "@/lib/shared/notes";

interface NotePreviewProps {
  /** Relative path of the open note (.md), used to resolve relative image srcs. */
  noteRel: string;
  content: string;
}

/** Resolve a relative image reference in a note to a servable URL.
 *  `src` is relative to the note's directory. External/absolute/data URLs pass through. */
function resolveImageSrc(src: string, noteRel: string, noteDir: string): string {
  if (/^(https?:|data:|blob:|\/)/i.test(src)) return src;
  if (!src.startsWith(".")) return src; // bare filename — treat as same-dir
  const target = src.startsWith("./") ? src.slice(2) : src.slice(1);
  const rel = noteDir ? `${noteDir}/${target}` : target;
  return noteMediaUrl(rel);
}

/** Read-only markdown preview for a note. Reuses pi-work's custom renderers
 *  (code / mermaid / svg / echarts) so preview matches the chat experience. */
export function NotePreview({ noteRel, content }: NotePreviewProps) {
  const noteDir = useMemo(
    () => noteRel.includes("/") ? noteRel.slice(0, noteRel.lastIndexOf("/")) : "",
    [noteRel],
  );

  const components = useMemo(
    () => ({
      code({ className, children, ...props }: { className?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
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
          src={props.src && typeof props.src === "string" ? resolveImageSrc(props.src, noteRel, noteDir) : undefined}
          alt={props.alt ?? ""}
          style={{ maxWidth: "100%", borderRadius: 6 }}
          loading="lazy"
        />
      ),
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props} target="_blank" rel="noreferrer noopener" />
      ),
    }),
    [noteRel, noteDir],
  );

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}