"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useI18n } from "@/hooks/useI18n";
import {
  TOOL_MARKET_DEFINITIONS,
  type ToolMarketCategory,
  type ToolMarketDefinition,
} from "@/lib/shared/tools-market";
import { ToolCard } from "./ToolCard";

const codeStyle: React.CSSProperties = {
  margin: 0, padding: 12, border: "1px solid var(--border)", borderRadius: 6,
  background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)",
  fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
  maxHeight: 280, overflow: "auto",
};

// Display order + i18n labels for the category groups.
const CATEGORY_ORDER: ToolMarketCategory[] = ["coding", "web", "platform"];
const CATEGORY_LABEL_KEY: Record<ToolMarketCategory, string> = {
  coding: "Coding tools",
  web: "Web search tools",
  platform: "Pi Work platform tools",
};

/**
 * Modal for browsing the built-in tool market.
 *
 * Layout (mirrors the SkillsConfig modal):
 *   • Overview — every tool as a card in a grid grouped by category
 *     (`coding` / `web` / `platform`). Each card shows the tool's
 *     initial-letter avatar, translated name, id and description. Clicking a
 *     card opens its detail page.
 *   • Detail   — parameters / returns schema and prompt metadata for the
 *     clicked tool, with a back button returning to the grid.
 *
 * The tool definitions come from `/api/tools-market`, falling back to the
 * bundled `TOOL_MARKET_DEFINITIONS` when the request fails.
 */
export function ToolsMarketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({ isOpen: open, onClose });
  const [definitions, setDefinitions] = useState<ToolMarketDefinition[]>(TOOL_MARKET_DEFINITIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ToolMarketCategory | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/tools-market");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { tools?: ToolMarketDefinition[] };
      if (data.tools && data.tools.length > 0) setDefinitions(data.tools);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) { setSelectedId(null); void load(); } }, [open, load]);

  const selected = definitions.find((tool) => tool.id === selectedId) ?? null;

  const filtered = useMemo(() => definitions.filter((tool) =>
    (category === "all" || tool.category === category) &&
    `${tool.name} ${tool.id} ${tool.description}`.toLowerCase().includes(query.toLowerCase()),
  ), [definitions, category, query]);

  const groups = useMemo(() => CATEGORY_ORDER
    .map((cat) => ({ cat, tools: filtered.filter((tool) => tool.category === cat) }))
    .filter((group) => group.tools.length > 0), [filtered]);

  if (!isVisible) return null;

  const BackHeader = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 18px 12px", flexShrink: 0 }}>
      <button
        onClick={onClick}
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {t("Tool Market")}
      </button>
      <span style={{ color: "var(--text-dim)", fontSize: 12 }}>/</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </div>
  );

  return (
    <div style={backdropStyle} onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, width: 860, height: "78vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 18px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{t("Tool Market")}</span>
            <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{t("Built-in tools")}</code>
          </div>
          <button onClick={requestClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {selected ? (
          <>
            <BackHeader label={t(selected.name)} onClick={() => setSelectedId(null)} />
            <ToolDetail tool={selected} />
          </>
        ) : (
          <>
            {/* Toolbar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 18px 12px", flexShrink: 0 }}>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Search")}
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
              />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as ToolMarketCategory | "all")}
                style={{ padding: 7, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 12, flexShrink: 0 }}
              >
                <option value="all">{t("All")}</option>
                <option value="coding">{t("Coding tools")}</option>
                <option value="web">{t("Web search tools")}</option>
                <option value="platform">{t("Pi Work platform tools")}</option>
              </select>
            </div>

            {/* Overview grid */}
            <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "2px 18px 18px" }}>
              {loading ? (
                <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-muted)" }}>{t("Loading...")}</div>
              ) : error ? (
                <div style={{ padding: "10px 2px", fontSize: 12, color: "#f87171" }}>
                  {error}
                  <button onClick={() => void load()} style={{ marginLeft: 12 }}>{t("Retry")}</button>
                </div>
              ) : groups.length === 0 ? (
                <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-dim)" }}>{t("No tools available")}</div>
              ) : (
                groups.map(({ cat, tools }) => (
                  <section key={cat} style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 2px 10px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {t(CATEGORY_LABEL_KEY[cat])}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{tools.length}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
                      {tools.map((tool) => (
                        <ToolCard key={tool.id} tool={tool} onOpen={() => setSelectedId(tool.id)} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "10px 18px", flexShrink: 0 }}>
          <button
            onClick={requestClose}
            style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}
          >
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolDetail({ tool }: { tool: ToolMarketDefinition }) {
  const { t } = useI18n();
  return <div data-scroll-wide style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t(tool.name)}</div><code style={{ fontSize: 11, color: "var(--text-muted)" }}>{tool.id}</code></div></div>
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}><div><div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 5 }}>{t("Description")}</div><div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>{t(tool.description)}</div></div>{tool.promptSnippet && <div><div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 7 }}>{t("Prompt Snippet")}</div><pre style={codeStyle}>{tool.promptSnippet}</pre></div>}{tool.promptGuidelines.length > 0 && <div><div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 7 }}>{t("System Prompt Guidelines")}</div><pre style={codeStyle}>{tool.promptGuidelines.join("\n")}</pre></div>}{tool.systemPrompt && <div><div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 7 }}>{t("Append System Prompt")}</div><pre style={codeStyle}>{tool.systemPrompt}</pre></div>}<div><div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 7 }}>{t("Input Schema")}</div><pre style={codeStyle}>{JSON.stringify(tool.parameters, null, 2)}</pre></div><div><div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 7 }}>{t("Output Schema")}</div><pre style={codeStyle}>{JSON.stringify(tool.returns, null, 2)}</pre></div></div>
  </div>;
}
