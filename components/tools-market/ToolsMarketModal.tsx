"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useI18n } from "@/hooks/useI18n";
import { TOOL_MARKET_DEFINITIONS, type ToolMarketDefinition } from "@/lib/shared/tools-market";

const codeStyle: React.CSSProperties = {
  margin: 0, padding: 12, border: "1px solid var(--border)", borderRadius: 6,
  background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)",
  fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
  maxHeight: 280, overflow: "auto",
};

export function ToolsMarketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({ isOpen: open, onClose });
  const [selected, setSelected] = useState<ToolMarketDefinition | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/tools-market");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { tools?: ToolMarketDefinition[] };
      const definitions = data.tools ?? TOOL_MARKET_DEFINITIONS;
      setSelected(definitions[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const tools = useMemo(() => TOOL_MARKET_DEFINITIONS.filter((tool) =>
    (category === "all" || tool.category === category) &&
    `${tool.name} ${tool.id} ${tool.description}`.toLowerCase().includes(query.toLowerCase()),
  ), [category, query]);

  if (!isVisible) return null;
  return (
    <div style={backdropStyle} onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, width: 860, height: "78vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("Tool Market")}</span>
            <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{t("Built-in tools")}</code>
          </div>
          <button onClick={requestClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>
        {error ? <div style={{ padding: 18, fontSize: 12, color: "#f87171" }}>{error}<button onClick={() => void load()} style={{ marginLeft: 12 }}>{t("Retry")}</button></div> : (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <div style={{ width: 240, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div style={{ padding: "8px 10px" }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search")} style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)" }} /></div>
              <div style={{ padding: "0 10px 8px" }}><select value={category} onChange={(event) => setCategory(event.target.value)} style={{ width: "100%", padding: 7, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)" }}><option value="all">{t("All")}</option><option value="coding">{t("Coding tools")}</option><option value="web">{t("Web search tools")}</option><option value="platform">{t("Pi Work platform tools")}</option></select></div>
              <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>{loading ? <div style={{ padding: 10, fontSize: 12, color: "var(--text-muted)" }}>{t("Loading...")}</div> : tools.map((tool) => {
                return (
                  <div
                    key={tool.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "9px 8px", marginBottom: 2,
                      border: 0, borderRadius: 5,
                      background: selected?.id === tool.id ? "var(--bg-hover)" : "transparent",
                      color: "var(--text)", width: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(tool)}
                      style={{
                        flex: 1, minWidth: 0, textAlign: "left",
                        background: "transparent", border: 0, padding: 0,
                        color: "var(--text)", cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: selected?.id === tool.id ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(tool.name)}</div>
                      <code style={{ fontSize: 10, color: "var(--text-dim)" }}>{tool.id}</code>
                    </button>
                  </div>
                );
              })}</div>
            </div>
            {selected && <ToolDetail tool={selected} />}
          </div>
        )}
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
