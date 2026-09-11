"use client";

import { type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import { avatarPalette } from "../skills-config/SkillCard";
import { TruncatedText } from "../skills-config/TruncatedText";
import { SectionTitle } from "./form-fields";
import { getDisplayedThinkingLevels } from "./utils";
import type { RuntimeModelInfo } from "./types";

const TITLE_STYLE = {
  flex: 1,
  minWidth: 0,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const SUBTITLE_STYLE = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--text-dim)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const SUMMARY_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "4px 10px",
  fontSize: 11.5,
  color: "var(--text-muted)",
} as const;

/** Reasoning badge reused by both card variants. */
export function ReasoningBadge() {
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 9,
        padding: "1px 5px",
        background: "rgba(99,102,241,0.12)",
        color: "rgba(99,102,241,0.9)",
        borderRadius: 3,
        fontWeight: 600,
      }}
    >
      T
    </span>
  );
}

/**
 * Round avatar shared by the model cards. Renders the provider's brand icon
 * when one is available, otherwise a deterministic pastel initial avatar
 * (same palette as `SkillCard`). Mirrors the skill card so both card grids
 * read as the same kind of object.
 */
export function ModelAvatar({ iconId, seed, size = 30 }: { iconId?: string; seed: string; size?: number }) {
  const resolved = iconId && hasProviderIcon(iconId) ? iconId : undefined;
  if (resolved) {
    return (
      <span
        style={{
          flexShrink: 0,
          width: size,
          height: size,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-hover)",
          color: "var(--text-muted)",
        }}
      >
        <ProviderIcon id={resolved} size={Math.round(size * 0.6)} />
      </span>
    );
  }
  const palette = avatarPalette(seed);
  return (
    <span
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: palette.bg,
        color: palette.fg,
        fontSize: Math.round(size * 0.47),
        fontWeight: 700,
      }}
    >
      {(seed.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/**
 * Shared card shell — the SkillCard visual (rounded border, hover lift,
 * avatar + title header, muted meta lines) that both `ModelCard` (runtime
 * catalog) and `ModelEntryCard` (custom models) build on.
 */
export function ModelCardShell({
  iconId,
  seed,
  title,
  subtitle,
  badge,
  summary,
  trailing,
  expanded,
  onClick,
  children,
}: {
  iconId?: string;
  seed: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  summary?: ReactNode;
  trailing?: ReactNode;
  expanded?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        background: expanded ? "var(--bg-panel)" : "transparent",
        border: `1px solid ${expanded ? "var(--text-dim)" : "var(--border)"}`,
        borderRadius: 12,
        cursor: "pointer",
        transition: "border-color 0.12s, box-shadow 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-panel)";
        if (!expanded) e.currentTarget.style.borderColor = "var(--text-dim)";
        e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = expanded ? "var(--bg-panel)" : "transparent";
        if (!expanded) e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ModelAvatar iconId={iconId} seed={seed} />
        <TruncatedText text={title} side="bottom" always style={TITLE_STYLE} />
        {badge}
        {trailing}
      </div>

      {subtitle && <TruncatedText text={subtitle} side="bottom" style={SUBTITLE_STYLE} />}

      {summary && <div style={SUMMARY_STYLE}>{summary}</div>}

      {children}
    </div>
  );
}

/**
 * One runtime model rendered as a card in `RuntimeModelList`, mirroring the
 * SkillsConfig `SkillCard` (round avatar + bold name + muted meta lines).
 *
 * Card anatomy:
 *   ┌──────────────────────────────────────────┐
 *   │ (A)  model-name                 [T]  [⌄] │
 *   │      provider / model-id                 │
 *   │  Context window · Max output · Reasoning │
 *   ├───────────── (click to expand) ──────────┤
 *   │ API / Input / Thinking levels / Cost ... │
 *   └──────────────────────────────────────────┘
 */
export function ModelCard({
  model,
  expanded,
  onToggle,
}: {
  model: RuntimeModelInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const levels = getDisplayedThinkingLevels(model);

  return (
    <ModelCardShell
      iconId={model.provider}
      seed={model.provider}
      title={model.name || model.id}
      subtitle={`${model.provider} / ${model.id}`}
      badge={undefined}
      expanded={expanded}
      onClick={onToggle}
      summary={
        <>
          <span>
            {t("Context window")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.contextWindow.toLocaleString()}</b>
          </span>
          <span>
            {t("Max output")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.maxTokens.toLocaleString()}</b>
          </span>
          <span>
            {t("Reasoning")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.reasoning ? t("Supported") : t("Not supported")}</b>
          </span>
        </>
      }
      trailing={
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            color: "var(--text-dim)",
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      }
    >
      {expanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 2, paddingTop: 11, borderTop: "1px solid var(--border)" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, fontSize: 11 }}>
            <span style={{ color: "var(--text-muted)" }}>{t("API")}: <b style={{ color: "var(--text)" }}>{model.api}</b></span>
            <span style={{ color: "var(--text-muted)" }}>{t("Input")}: <b style={{ color: "var(--text)" }}>{model.input.join(", ")}</b></span>
            <span style={{ color: "var(--text-muted)" }}>{t("Thinking levels")}: <b style={{ color: "var(--text)" }}>{levels.join(", ") || t("Provider default")}</b></span>
            <span style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>{t("Base URL")}: <b style={{ color: "var(--text)" }}>{model.baseUrl || "—"}</b></span>
            <span style={{ color: "var(--text-muted)" }}>{t("Headers")}: <b style={{ color: "var(--text)" }}>{Object.keys(model.headers ?? {}).length || 0}</b></span>
            <span style={{ color: "var(--text-muted)" }}>{t("Compatibility")}: <b style={{ color: "var(--text)" }}>{Object.keys(model.compat ?? {}).length || 0}</b></span>
          </div>

          <div>
            <SectionTitle>{t("Cost (per million tokens)")}</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 6, fontSize: 10 }}>
              {(["input", "output", "cacheRead", "cacheWrite"] as const).map((key) => (
                <div key={key} style={{ padding: "6px 7px", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)" }}>
                  <div>{key}</div>
                  <b style={{ display: "block", marginTop: 3, color: "var(--text)" }}>{model.cost?.[key] ?? "—"}</b>
                </div>
              ))}
            </div>
            {model.cost?.tiers && model.cost.tiers.length > 0 && (
              <div style={{ marginTop: 7, fontSize: 10, color: "var(--text-muted)" }}>
                <div style={{ marginBottom: 4 }}>{t("Cost tiers")}</div>
                <pre style={{ margin: 0, padding: 7, maxHeight: 120, overflow: "auto", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {JSON.stringify(model.cost.tiers, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <details onClick={(e) => e.stopPropagation()}>
            <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 10 }}>{t("Raw metadata")}</summary>
            <pre style={{ margin: "6px 0 0", padding: 8, maxHeight: 220, overflow: "auto", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {JSON.stringify({ headers: model.headers, compat: model.compat, thinkingLevelMap: model.thinkingLevelMap }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </ModelCardShell>
  );
}
