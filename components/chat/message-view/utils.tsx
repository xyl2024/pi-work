"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { Tooltip } from "../../ui/Tooltip";
import { MermaidBlock } from "@/components/renderers/MermaidBlock";
import { EchartsBlock } from "@/components/renderers/EchartsBlock";
import { SvgBlock } from "@/components/renderers/SvgBlock";
import { CodeBlock } from "@/components/renderers/CodeBlock";
import { MarkdownImage } from "@/components/renderers/ImageLightbox";

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
              background: "var(--bg-selected)",
              padding: "1px 4px",
              borderRadius: 3,
              fontFamily: "var(--font-mono)",
              fontSize: "0.9em",
              color: "var(--accent)",
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
    }),
    [isStreaming, onImageClick],
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

export function getToolPreview(block: { input?: unknown; toolName?: string }): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.length === 0) return "";

  const record = input as Record<string, unknown>;
  if ("command" in record) return String(record.command).slice(0, 120);
  if ("path" in record) return String(record.path).slice(0, 120);
  if ("file_path" in record) return String(record.file_path).slice(0, 120);
  if ("pattern" in record) return String(record.pattern).slice(0, 120);
  if ("query" in record) return String(record.query).slice(0, 120);

  const first = record[keys[0]];
  return String(first).slice(0, 120);
}

export function UsageIcons({ usage }: { usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } } }) {
  const { formatCost, currency } = useFormatCurrency();
  const inputDenom = usage.input + usage.cacheRead;
  const cacheHitRate = inputDenom > 0 ? (usage.cacheRead / inputDenom) * 100 : 0;
  const items: Array<{ key: string; label: string; icon: React.ReactNode }> = [];
  if (usage.input) {
    items.push({
      key: "in",
      label: `${usage.input.toLocaleString()} in · ${cacheHitRate.toFixed(1)}% cached`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 2.5v7" /><polyline points="3 6 6 9.5 9 6" />
        </svg>
      ),
    });
  }
  if (usage.output) {
    items.push({
      key: "out",
      label: `${usage.output.toLocaleString()} out`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9.5v-7" /><polyline points="3 6 6 2.5 9 6" />
        </svg>
      ),
    });
  }
  if (usage.cacheRead || usage.cacheWrite) {
    items.push({
      key: "cache",
      label: `${cacheHitRate.toFixed(1)}% cache hit`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <ellipse cx="6" cy="3.5" rx="3.5" ry="1.4" /><path d="M2.5 3.5v2.6c0 .77 1.57 1.4 3.5 1.4s3.5-.63 3.5-1.4V3.5" /><path d="M2.5 6.1v2.6c0 .77 1.57 1.4 3.5 1.4s3.5-.63 3.5-1.4V6.1" />
        </svg>
      ),
    });
  }
  if (typeof usage.cost?.total === "number" && usage.cost.total > 0) {
    const usd = usage.cost.total;
    const formatted = formatCost(usd);
    const tooltipLabel = currency === "CNY"
      ? `${formatted}  (≈ $${usd.toFixed(4)} USD)`
      : formatted;
    items.push({
      key: "cost",
      label: tooltipLabel,
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 1.5v9" /><path d="M8 3.2c-.5-.9-2.2-1.2-3-.6-.8.6-.7 1.7.2 2.2l1.9.9c1 .5 1 1.7.1 2.3-.9.7-2.7.3-3.2-.7" />
        </svg>
      ),
    });
  }
  if (items.length === 0) return null;
  const compact = (item: typeof items[number]): string => {
    if (item.key === "in") return usage.input.toLocaleString();
    if (item.key === "out") return usage.output.toLocaleString();
    if (item.key === "cache") return `${cacheHitRate.toFixed(0)}%`;
    if (item.key === "cost") {
      return formatCost(usage.cost.total);
    }
    return "";
  };
  return (
    <>
      {items.map((item) => (
        <Tooltip key={item.key} content={item.label}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-dim)", fontSize: 11 }}>
            {item.icon}
            <span>{compact(item)}</span>
          </span>
        </Tooltip>
      ))}
    </>
  );
}
