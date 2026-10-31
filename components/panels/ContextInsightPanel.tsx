"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendAgentCommand, type ToolWithActive } from "@/lib/client/agent-client";
import type { SessionEvent } from "@/lib/shared/session-events";
import { splitBaseBlocks, splitSystemPrompt } from "@/lib/shared/system-prompt-segments";
import { useI18n } from "@/hooks/useI18n";
import { ChevronDownIcon, ChevronRightIcon } from "../ui/icons/primitives";

interface ContextInsightData {
  systemPrompt: string | null;
  tools: ToolWithActive[];
}

interface PromptItem {
  id: string;
  label: string;
  color: string | null;
  text: string;
}

const AGENTS_SEGMENT_COLORS = [
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
];

const BASE_BLOCK_LABEL_KEYS: Record<string, string> = {
  "available-tools": "Available tools",
  guidelines: "Guidelines",
  "pi-docs": "Pi documentation",
  append: "Append",
  skills: "Skills",
  cwd: "Current working directory",
};

const SECTION_TITLE_STYLE = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--accent)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.07em",
  marginBottom: 6,
};

const ROW_TEXT_STYLE = {
  whiteSpace: "pre-wrap" as const,
  overflowWrap: "anywhere" as const,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  lineHeight: 1.55,
  color: "var(--text-muted)",
};

function baseBlockLabelKey(anchor: string | null): string {
  if (!anchor) return "Pi base prompt";
  return BASE_BLOCK_LABEL_KEYS[anchor] ?? anchor;
}

function CollapsibleRow({
  label,
  color,
  expanded,
  onToggle,
  monoLabel,
  children,
}: {
  label: string;
  color: string | null;
  expanded: boolean;
  onToggle: () => void;
  monoLabel: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: "1px solid color-mix(in srgb, var(--border) 55%, transparent)" }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "7px 0",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          font: "inherit",
          fontSize: 11,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", flexShrink: 0, color: "var(--text-dim)" }}>
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>
        {color && <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: color }} />}
        <span
          title={label}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: monoLabel ? "var(--font-mono)" : "inherit",
            color: color ?? "var(--text-muted)",
          }}
        >
          {label}
        </span>
      </button>
      {expanded && <div style={{ padding: "0 0 10px 20px" }}>{children}</div>}
    </div>
  );
}

export function ContextInsightPanel({ sessionId, visible }: { sessionId: string | null; visible: boolean }) {
  const { t } = useI18n();
  const cacheRef = useRef<Map<string, ContextInsightData>>(new Map());
  const requestSeqRef = useRef(0);
  const [entry, setEntry] = useState<{ sessionId: string; data: ContextInsightData } | null>(null);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const data = entry?.sessionId === sessionId
    ? entry.data
    : sessionId
      ? cacheRef.current.get(sessionId) ?? null
      : null;
  const loading = loadingSession === sessionId && data === null;

  const load = useCallback(async (id: string) => {
    const seq = ++requestSeqRef.current;
    setLoadingSession(id);
    const [state, tools] = await Promise.all([
      fetch(`/api/agent/${encodeURIComponent(id)}`)
        .then((r) => r.json() as Promise<{ state?: { systemPrompt?: string } }>)
        .catch(() => null),
      sendAgentCommand<ToolWithActive[]>(id, { type: "get_tools" }).catch(() => null),
    ]);
    if (requestSeqRef.current !== seq) return;
    const next: ContextInsightData = {
      systemPrompt: state?.state?.systemPrompt ?? null,
      tools: Array.isArray(tools) ? tools.filter((tool) => tool.active) : [],
    };
    cacheRef.current.set(id, next);
    setEntry({ sessionId: id, data: next });
    setLoadingSession(null);
  }, []);

  useEffect(() => {
    setExpanded(new Set());
  }, [sessionId]);

  useEffect(() => {
    if (!visible || !sessionId) {
      setLoadingSession(null);
      return;
    }
    void load(sessionId);
    const source = new EventSource(`/api/agent/${encodeURIComponent(sessionId)}/events`);
    source.onmessage = (message) => {
      let event: SessionEvent;
      try {
        event = JSON.parse(message.data) as SessionEvent;
      } catch {
        return;
      }
      if (event.type === "agent_settled" || event.type === "compaction_end") void load(sessionId);
    };
    return () => {
      requestSeqRef.current += 1;
      source.close();
    };
  }, [sessionId, visible, load]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const segments = useMemo(() => splitSystemPrompt(data?.systemPrompt ?? ""), [data?.systemPrompt]);

  const pathColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const seg of segments) {
      if (seg.kind === "agents" && !map.has(seg.path)) {
        map.set(seg.path, AGENTS_SEGMENT_COLORS[map.size % AGENTS_SEGMENT_COLORS.length]);
      }
    }
    return map;
  }, [segments]);

  const promptItems = useMemo(() => {
    const items: PromptItem[] = [];
    for (const seg of segments) {
      if (seg.kind === "agents") {
        items.push({
          id: `prompt-${items.length}`,
          label: seg.path,
          color: pathColor.get(seg.path) ?? null,
          text: seg.text,
        });
        continue;
      }
      for (const block of splitBaseBlocks(seg.text)) {
        if (!block.text.trim()) continue;
        items.push({
          id: `prompt-${items.length}`,
          label: t(baseBlockLabelKey(block.anchor)),
          color: null,
          text: block.text,
        });
      }
    }
    return items;
  }, [segments, pathColor, t]);

  const tools = useMemo(
    () => [...(data?.tools ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data?.tools],
  );

  if (!sessionId) {
    return (
      <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
        {t("Open a session first")}
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        background: "transparent",
        color: "var(--text-muted)",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <section style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={SECTION_TITLE_STYLE}>{t("System Prompt")}</div>
        {data === null ? (
          loading ? <div style={{ fontStyle: "italic" }}>{t("Loading…")}</div> : null
        ) : promptItems.length === 0 ? (
          <div style={{ fontStyle: "italic" }}>{t("System prompt is empty (tools are disabled)")}</div>
        ) : (
          promptItems.map((item) => (
            <CollapsibleRow
              key={item.id}
              label={item.label}
              color={item.color}
              monoLabel={item.color !== null}
              expanded={expanded.has(item.id)}
              onToggle={() => toggle(item.id)}
            >
              <pre style={{ ...ROW_TEXT_STYLE, margin: 0 }}>{item.text}</pre>
            </CollapsibleRow>
          ))
        )}
      </section>

      <section style={{ padding: "12px 16px" }}>
        <div style={SECTION_TITLE_STYLE}>{t("Tools")}</div>
        {data === null ? (
          loading ? <div style={{ fontStyle: "italic" }}>{t("Loading tools...")}</div> : null
        ) : (
          tools.map((tool) => {
            const id = `tool-${tool.name}`;
            const schema = tool.parameters === undefined ? null : JSON.stringify(tool.parameters, null, 2);
            return (
              <CollapsibleRow
                key={tool.name}
                label={tool.name}
                color={null}
                monoLabel
                expanded={expanded.has(id)}
                onToggle={() => toggle(id)}
              >
                <pre style={{ ...ROW_TEXT_STYLE, margin: "0 0 8px" }}>
                  {tool.description || t("No description")}
                </pre>
                {schema && <pre style={{ ...ROW_TEXT_STYLE, margin: 0 }}>{schema}</pre>}
              </CollapsibleRow>
            );
          })
        )}
      </section>
    </div>
  );
}
