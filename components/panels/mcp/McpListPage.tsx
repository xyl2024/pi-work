"use client";

import { useI18n } from "@/hooks/useI18n";
import { shortenPath } from "@/lib/client/paths";
import {
  entryUsesCodemode,
  MCP_SCOPES,
  projectMcpProblems,
  summarizeMcpProblems,
  type McpProblem,
  type McpScope,
} from "@/lib/shared/mcp-panel";
import type { McpDraftBucket } from "@/lib/shared/mcp-drafts";
import {
  addMcpServer,
  disableGlobalInProject,
  openMcpEntry,
  setMcpAutoEnable,
  setMcpEntryConfig,
} from "@/lib/client/mcp-panel";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Tooltip } from "@/components/ui/Tooltip";
import { McpEntryCard } from "./McpEntryCard";
import { McpNotice } from "./McpNotice";
import { mcpScopeLabelKey } from "./scopeLabel";

export function McpListPage({ bucket }: { bucket: McpDraftBucket }) {
  const { t } = useI18n();
  const { data, draft } = bucket;

  const problems = projectMcpProblems(data);
  const summary = summarizeMcpProblems(problems);
  const scopeLabel = (scope: McpScope) => t(mcpScopeLabelKey(scope));
  const problemLevel = (problem: McpProblem) =>
    problem.level === "file"
      ? t("mcp.problemFileLevel")
      : t("mcp.problemEntryLevel", { name: problem.name ?? "" });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("mcp.title")}</span>
        <button
          type="button"
          onClick={() => addMcpServer("global")}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 12px",
            fontSize: 12.5,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("mcp.add")}
        </button>
      </div>

      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 14px 16px" }}>
        {!data.projectTrusted && (
          <McpNotice tone="warn">{t("mcp.projectDisabled")}</McpNotice>
        )}

        {problems.length > 0 && (
          <McpNotice tone="error">
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                {t("mcp.problemsTitle")} ·{" "}
                {[
                  summary.files > 0 ? t("mcp.problemsFiles", { count: summary.files }) : null,
                  summary.entries > 0 ? t("mcp.problemsEntries", { count: summary.entries }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </summary>
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                {problems.map((problem, index) => (
                  <div key={`${problem.scope}-${problem.level}-${problem.name}-${index}`}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {problemLevel(problem)}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{problem.message}</div>
                  </div>
                ))}
              </div>
            </details>
          </McpNotice>
        )}

        {MCP_SCOPES.map((scope) => {
          const file = data.files.find((item) => item.scope === scope);
          const entries = draft.entries.filter((entry) => entry.scope === scope);
          if (!file) return null;
          const codemodeAffects = entries.some((entry) => entryUsesCodemode(entry.config));
          return (
            <section key={scope} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0 10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {scopeLabel(scope)}
                </span>
                <code
                  title={file.path}
                  style={{
                    fontSize: 11,
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 190,
                  }}
                >
                  {shortenPath(file.path)}
                </code>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{entries.length}</span>
                {codemodeAffects && (
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Tooltip content={t("mcp.autoEnableCodemodeHint")} side="top">
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("mcp.autoEnableCodemode")}</span>
                    </Tooltip>
                    <ToggleSwitch
                      size="sm"
                      on={draft.autoEnableCodemode[scope]}
                      disabled={!file.exists && entries.length === 0}
                      onChange={(next) => setMcpAutoEnable(scope, next)}
                      label={t("mcp.autoEnableCodemode")}
                    />
                  </span>
                )}
              </div>

              {file.parseError ? null : !file.exists ? (
                <McpNotice tone="info">{t("mcp.fileMissing")}</McpNotice>
              ) : entries.length === 0 ? (
                <McpNotice tone="info">{t("mcp.empty")}</McpNotice>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
                  {entries.map((entry) => (
                    <McpEntryCard
                      key={entry.uid}
                      entry={entry}
                      onOpen={() => openMcpEntry(entry.uid)}
                      onToggleEnabled={(enabled) =>
                        setMcpEntryConfig(entry.uid, { ...(entry.config ?? {}), enabled })
                      }
                      onDisableInProject={
                        scope === "global" && data.projectTrusted && !entry.shadowedByProject
                          ? () => disableGlobalInProject(entry.name)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
