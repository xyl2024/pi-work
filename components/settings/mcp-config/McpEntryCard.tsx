"use client";

import { type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { TruncatedText } from "../skills-config/TruncatedText";
import { avatarPalette } from "../skills-config/SkillCard";
import { isEntryDirty, type McpDraftEntry } from "@/lib/shared/mcp-draft";
import { isEnabled, summarizeEntry, transportOf } from "./utils";

/**
 * One MCP server entry as a card in the panel's grid — deliberately the same
 * anatomy as SkillCard: avatar, mono name, inline enable toggle, clamped
 * summary line. Clicking the card opens the entry's form; the toggle edits the
 * draft in place (nothing is written until Save).
 *
 * The badge row is where the panel's vocabulary shows up: pi's validation
 * error, the cross-file override, and whether the entry is new / edited /
 * marked for deletion.
 */

const CLAMP_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

function Badge({ label, tone }: { label: string; tone: "error" | "accent" | "muted" | "warn" }) {
  const color =
    tone === "error" ? "var(--error)" : tone === "accent" ? "var(--accent)" : tone === "warn" ? "var(--text)" : "var(--text-dim)";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1.6,
        padding: "0 6px",
        borderRadius: 4,
        color,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function McpEntryCard({
  entry,
  onOpen,
  onToggleEnabled,
}: {
  entry: McpDraftEntry;
  onOpen: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const palette = avatarPalette(entry.name || "mcp");
  const transport = transportOf(entry.config);
  const initial = (entry.name.trim()[0] ?? "?").toUpperCase();
  const summary = summarizeEntry(entry.config) || t("mcp.empty");
  const dirty = isEntryDirty(entry);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 12,
        cursor: "pointer",
        opacity: entry.deleted ? 0.5 : 1,
        transition: "border-color 0.12s, box-shadow 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-panel)";
        e.currentTarget.style.borderColor = "var(--text-dim)";
        e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: palette.bg,
            color: palette.fg,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {initial}
        </span>
        <TruncatedText
          text={entry.name || t("mcp.noName")}
          side="bottom"
          always
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            color: isEnabled(entry.config) ? "var(--text)" : "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        />
        <span style={{ display: "inline-flex" }}>
          <ToggleSwitch
            size="sm"
            on={isEnabled(entry.config)}
            disabled={entry.config === null}
            onChange={onToggleEnabled}
            label={isEnabled(entry.config) ? t("mcp.disabled") : t("mcp.enabled")}
          />
        </span>
      </div>

      <TruncatedText
        text={summary}
        side="bottom"
        style={{ ...CLAMP_STYLE, fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)", minHeight: 38 }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {transport !== "unknown" && (
          <Badge label={transport === "http" ? "HTTP" : "stdio"} tone="muted" />
        )}
        {entry.deleted && <Badge label={t("mcp.deleted")} tone="error" />}
        {!entry.deleted && entry.loadError && <Badge label={t("mcp.invalid")} tone="error" />}
        {!entry.deleted && entry.shadowsGlobal && <Badge label={t("mcp.shadowsGlobal")} tone="warn" />}
        {!entry.deleted && entry.shadowedByProject && <Badge label={t("mcp.shadowedByProject")} tone="warn" />}
        {!entry.deleted && entry.originalName === null && <Badge label={t("mcp.new")} tone="accent" />}
        {!entry.deleted && dirty && entry.originalName !== null && <Badge label={t("mcp.unsaved")} tone="accent" />}
        {!entry.deleted && !isEnabled(entry.config) && <Badge label={t("mcp.disabled")} tone="muted" />}
      </div>
    </div>
  );
}
