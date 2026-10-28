"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { Tooltip } from "../../ui/Tooltip";
import { MermaidBlock } from "@/components/renderers/MermaidBlock";
import { EchartsBlock } from "@/components/renderers/EchartsBlock";
import { SvgBlock } from "@/components/renderers/SvgBlock";
import { CodeBlock } from "@/components/renderers/CodeBlock";
import { MarkdownImage } from "@/components/renderers/ImageLightbox";
import { resolveFileLink } from "@/lib/shared/file-link";
import { LEGACY_SPAWN_SUBAGENT_TOOL_NAME, SUBAGENT_TOOL_NAME } from "@/lib/shared/subagent";
import type { MessageCallMetrics } from "@/lib/shared/token-audit-types";
import { useFileLinkHandler } from "./context";

export function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  const parts = [`${h}h`];
  if (remM > 0) parts.push(`${remM}m`);
  if (remM === 0 && remS > 0) parts.push(`${remS}s`);
  return parts.join(" ");
}

export function highlightKeywords(text: string, keywords?: string[], isSearchMatch?: boolean): React.ReactNode {
  if (!keywords || keywords.length === 0 || !isSearchMatch) return text;
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = escaped.join("|");
  const regex = new RegExp(pattern, "gi");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<mark key={key++} className="search-highlight">{match[0]}</mark>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

export function highlightTextAsHtml(text: string, keywords?: string[], isSearchMatch?: boolean): string {
  if (!keywords || keywords.length === 0 || !isSearchMatch) return text;
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = escaped.join("|");
  const regex = new RegExp(pattern, "gi");
  return text.replace(regex, (match) => `<mark class="search-highlight">${match}</mark>`);
}

export function useMarkdownComponents(
  isStreaming?: boolean,
  onImageClick?: (src: string) => void,
) {
  return useMemo(
    () => ({
      code({ className, children, ...props }: { className?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
        const lang = className?.replace("language-", "") ?? "";
        const raw = String(children ?? "");
        const isBlock = className?.includes("language-") || raw.includes("\n");
        if (isBlock) {
          if (lang === "mermaid") {
            return <MermaidBlock key={raw} code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
          }
          if (lang === "svg") {
            return <SvgBlock key={raw} code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
          }
          if (lang === "echarts") {
            return <EchartsBlock key={raw} code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
          }
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
      img: onImageClick
        ? (props: { src?: string | Blob; alt?: string }) => (
            <MarkdownImage
              {...props}
              resolveSrc={(s) => (typeof s === "string" ? s : "")}
              onImageClick={onImageClick}
            />
          )
        : undefined,
      a: MarkdownLink,
    }),
    [isStreaming, onImageClick],
  );
}

/**
 * Anchors in chat markdown: a bare path (`/abs/a.ts` or a cwd-relative
 * `src/a.ts`) opens in the right panel instead of navigating. External links,
 * fragments and routes fall through to the plain anchor, leaving
 * `useExternalLinks` to handle http(s).
 */
function MarkdownLink({ href, children, ...props }: React.ComponentPropsWithoutRef<"a">) {
  const handler = useFileLinkHandler();
  const target = handler ? resolveFileLink(href, handler.cwd) : null;
  if (handler && target) {
    return (
      <a
        {...props}
        href={href}
        title={target.path}
        style={{ cursor: "pointer", ...props.style }}
        onClick={(event) => {
          event.preventDefault();
          handler.openFile(target.path, target.name);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a {...props} href={href}>
      {children}
    </a>
  );
}

/** Live per-turn duration. Ticks every second while running, freezes on stop, and becomes fully static once endMs arrives. */
export function TurnDuration({ startMs, endMs, running }: { startMs: number; endMs?: number; running: boolean }) {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  useEffect(() => {
    if (endMs !== undefined || !running) return;
    const tick = () => setElapsedMs(Date.now() - startMs);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endMs, running, startMs]);
  const ms = endMs !== undefined ? endMs - startMs : (elapsedMs ?? 0);
  return <span>{formatDuration(ms)}</span>;
}

const PREVIEW_PART_LIMIT = 80;
const PREVIEW_TOTAL_LIMIT = 160;

function previewPart(value: unknown): string {
  return String(value).slice(0, PREVIEW_PART_LIMIT);
}

export function getToolPreview(block: { input?: unknown; toolName?: string }): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.length === 0) return "";

  const record = input as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" && v.length > 0 ? v : "");

  let parts: string[];
  switch (block.toolName) {
    case "find":
    case "grep": {
      parts = [str(record.path), str(record.pattern)];
      break;
    }
    case "read":
    case "write":
    case "edit":
    case "ls": {
      parts = [str(record.path)];
      break;
    }
    case "bash": {
      parts = [str(record.command)];
      break;
    }
    // The current tool name, plus the pre-rename name still present in old
    // messages. `subagentType` is the even older field name on custom entries.
    case SUBAGENT_TOOL_NAME:
    case LEGACY_SPAWN_SUBAGENT_TOOL_NAME: {
      parts = [str(record.subagent_name) || str(record.subagentType), str(record.description)];
      break;
    }
    default: {
      // Fallback: first meaningful key, then any other key at all.
      const fallbackKey =
        ["command", "path", "file_path", "pattern", "query", "symbol", "action", "url", "name"].find((k) => k in record) ?? keys[0];
      parts = [String(record[fallbackKey])];
    }
  }

  return parts
    .filter((p) => p.length > 0)
    .map(previewPart)
    .join(" · ")
    .slice(0, PREVIEW_TOTAL_LIMIT);
}

export interface UsageIconsProps {
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } } | null;
}

/** First-token latency: sub-second reads better in ms, later in seconds. */
function formatTtft(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
}

/** Generation speed: keep one decimal, drop it once it stops mattering. */
function formatTps(tps: number): string {
  return tps >= 100 ? tps.toFixed(0) : tps.toFixed(1);
}

export function UsageIcons({ usage }: UsageIconsProps) {
  const { formatCost, currency } = useFormatCurrency();
  const inputDenom = usage ? usage.input + usage.cacheRead : 0;
  const cacheHitRate = inputDenom > 0 ? ((usage?.cacheRead ?? 0) / inputDenom) * 100 : 0;
  // Each item carries its tooltip and its compact footer text: the two differ
  // (a tooltip spells out what a bare number means) and deriving both from one
  // place keeps them from drifting apart.
  const items: Array<{ key: string; label: string; compact: string; icon: React.ReactNode }> = [];
  if (usage?.input) {
    items.push({
      key: "in",
      label: `${usage.input.toLocaleString()} in · ${cacheHitRate.toFixed(1)}% cached`,
      compact: usage.input.toLocaleString(),
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9.5v-7" /><polyline points="3 6 6 2.5 9 6" />
        </svg>
      ),
    });
  }
  if (usage?.output) {
    items.push({
      key: "out",
      label: `${usage.output.toLocaleString()} out`,
      compact: usage.output.toLocaleString(),
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 2.5v7" /><polyline points="3 6 6 9.5 9 6" />
        </svg>
      ),
    });
  }
  if (usage && (usage.cacheRead || usage.cacheWrite)) {
    items.push({
      key: "cache",
      label: `${cacheHitRate.toFixed(1)}% cache hit`,
      compact: `${cacheHitRate.toFixed(0)}%`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <ellipse cx="6" cy="3.5" rx="3.5" ry="1.4" /><path d="M2.5 3.5v2.6c0 .77 1.57 1.4 3.5 1.4s3.5-.63 3.5-1.4V3.5" /><path d="M2.5 6.1v2.6c0 .77 1.57 1.4 3.5 1.4s3.5-.63 3.5-1.4V6.1" />
        </svg>
      ),
    });
  }
  if (typeof usage?.cost?.total === "number" && usage.cost.total > 0) {
    const usd = usage.cost.total;
    const formatted = formatCost(usd);
    const tooltipLabel = currency === "CNY"
      ? `${formatted}  (≈ $${usd.toFixed(4)} USD)`
      : formatted;
    items.push({
      key: "cost",
      label: tooltipLabel,
      compact: formatCost(usd),
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 1.5v9" /><path d="M8 3.2c-.5-.9-2.2-1.2-3-.6-.8.6-.7 1.7.2 2.2l1.9.9c1 .5 1 1.7.1 2.3-.9.7-2.7.3-3.2-.7" />
        </svg>
      ),
    });
  }
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <Tooltip key={item.key} content={item.label}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-dim)", fontSize: 11 }}>
            {item.icon}
            <span>{item.compact}</span>
          </span>
        </Tooltip>
      ))}
    </>
  );
}

/**
 * TTFT / generation-speed badges. Rendered next to the model name in the
 * message header rather than in the footer, and hidden until the message is
 * hovered. Both facts come from the model-call metrics DB (not the session
 * JSONL), so a message whose call was never recorded simply shows nothing.
 */
export function CallMetricsBadges({ metrics, hidden }: {
  metrics?: MessageCallMetrics | null;
  /** Keep the badges mounted but transparent until the row is hovered. */
  hidden?: boolean;
}) {
  const items: Array<{ key: string; label: string; compact: string; icon: React.ReactNode }> = [];
  const ttft = metrics?.ttftMs;
  if (typeof ttft === "number" && Number.isFinite(ttft) && ttft >= 0) {
    const text = formatTtft(ttft);
    items.push({
      key: "ttft",
      label: `TTFT ${text}`,
      compact: `TTFT ${text}`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6.6 1.5 3.2 6.6h2.3l-.5 3.9 3.6-5.4H6.2z" />
        </svg>
      ),
    });
  }
  const tps = metrics?.generationTps;
  if (typeof tps === "number" && Number.isFinite(tps) && tps > 0) {
    const text = formatTps(tps);
    items.push({
      key: "tps",
      label: `${text} tok/s`,
      compact: `TPS ${text}`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 8.7a4 4 0 1 1 8 0" /><path d="M6 8.7 8.4 5.6" />
        </svg>
      ),
    });
  }
  if (items.length === 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        opacity: hidden ? 0 : 1,
        transition: "opacity 0.12s",
      }}
    >
      {items.map((item) => (
        <Tooltip key={item.key} content={item.label}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-dim)", fontSize: 11 }}>
            {item.icon}
            <span>{item.compact}</span>
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
