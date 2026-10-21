"use client";

import { useI18n } from "@/hooks/useI18n";
import { MCP_SCOPES, isMcpOverride, type McpScope } from "@/lib/shared/mcp-panel";
import type { McpDraftBucket } from "@/lib/shared/mcp-drafts";
import type { McpDraftEntry } from "@/lib/shared/mcp-draft";
import {
  backMcpPageAction,
  dropMcpEntry,
  setMcpEntryConfig,
  setMcpEntryDeleted,
  setMcpEntryName,
  setMcpEntryRawJson,
  setMcpEntryScope,
} from "@/lib/client/mcp-store";
import { SecondaryButton } from "@/components/settings/controls";
import { McpEntryForm } from "./McpEntryForm";
import { McpNotice } from "./McpNotice";
import { mcpScopeLabelKey } from "./scopeLabel";

/**
 * One server's entry page: the full-width form / raw-JSON editor, plus the
 * scope picker for a server added in this session and the delete affordances.
 *
 * The page owns no state: the draft entry comes from the module store, and every
 * edit writes straight back to it, so leaving the page (or the tab) cannot lose
 * a keystroke.
 */
export function McpEntryPage({ bucket, entry }: { bucket: McpDraftBucket; entry: McpDraftEntry }) {
  const { t } = useI18n();
  const scopeLabel = (scope: McpScope) => t(mcpScopeLabelKey(scope));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={backMcpPageAction}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
            flexShrink: 0,
          }}
          aria-label={t("Back")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t("mcp.title")}
        </button>
        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.name || t("mcp.noName")}
          <span style={{ color: "var(--text-dim)", fontWeight: 400 }}> · {scopeLabel(entry.scope)}</span>
        </span>
      </div>

      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 14px 16px" }}>
        <div style={{ maxWidth: 620 }}>
          {entry.originalName === null && (
            <ScopePicker
              value={entry.scope}
              projectDisabled={!bucket.data.projectTrusted}
              onChange={(scope) => setMcpEntryScope(entry.uid, scope)}
            />
          )}
          {entry.scope === "project" && <McpNotice tone="info">{t("mcp.projectAuthNote")}</McpNotice>}
          <McpEntryForm
            key={entry.uid}
            entry={entry}
            onNameChange={(name) => setMcpEntryName(entry.uid, name)}
            onConfigChange={(config) => setMcpEntryConfig(entry.uid, config)}
            onRawJsonChange={(text) => setMcpEntryRawJson(entry.uid, text)}
          />
          <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10 }}>
            {entry.originalName === null ? (
              <SecondaryButton onClick={() => dropMcpEntry(entry.uid)}>{t("mcp.delete")}</SecondaryButton>
            ) : entry.deleted ? (
              <SecondaryButton onClick={() => setMcpEntryDeleted(entry.uid, false)}>{t("mcp.undoDelete")}</SecondaryButton>
            ) : (
              <SecondaryButton onClick={() => setMcpEntryDeleted(entry.uid, true)}>
                {entry.scope === "project" && entry.config && isMcpOverride(entry.config) ? t("mcp.deleteOverride") : t("mcp.delete")}
              </SecondaryButton>
            )}
            {entry.deleted && <span style={{ fontSize: 11, color: "var(--error)" }}>{t("mcp.deleteHint")}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScopePicker({
  value,
  projectDisabled,
  onChange,
}: {
  value: McpScope;
  projectDisabled: boolean;
  onChange: (scope: McpScope) => void;
}) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("mcp.scope")} style={{ display: "flex", gap: 6, marginBottom: 14 }}>
      {MCP_SCOPES.map((scope) => {
        const disabled = scope === "project" && projectDisabled;
        const active = scope === value;
        return (
          <button
            key={scope}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? t("mcp.projectDisabled") : undefined}
            onClick={() => onChange(scope)}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 6,
              background: active ? "var(--accent)" : "var(--bg)",
              border: "1px solid var(--border)",
              color: active ? "#fff" : "var(--text)",
              fontSize: 13,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            {t(mcpScopeLabelKey(scope))}
          </button>
        );
      })}
    </div>
  );
}
