"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProviderIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import { avatarPalette } from "../skills-config/SkillCard";
import { TruncatedText } from "../skills-config/TruncatedText";
import { SectionTitle } from "./form-fields";
import { getDisplayedThinkingLevels } from "./utils";
import type { RuntimeModelInfo } from "./types";

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
 *
 * The provider's brand icon stands in for the skill's initial-letter avatar;
 * providers without a builtin icon fall back to a deterministic pastel
 * initial avatar (same palette as SkillCard).
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
  const hasBrandIcon = hasProviderIcon(model.provider);
  const palette = avatarPalette(model.provider);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
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
        <span
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: hasBrandIcon ? "var(--bg-hover)" : palette.bg,
            color: hasBrandIcon ? "var(--text-muted)" : palette.fg,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {hasBrandIcon ? (
            <ProviderIcon id={model.provider} size={18} />
          ) : (
            (model.provider.trim()[0] ?? "?").toUpperCase()
          )}
        </span>
        <TruncatedText
          text={model.name || model.id}
          side="bottom"
          always
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        />
        {model.reasoning && (
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
        )}
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
      </div>

      <TruncatedText
        text={`${model.provider} / ${model.id}`}
        side="bottom"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-dim)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: 11.5, color: "var(--text-muted)" }}>
        <span>
          {t("Context window")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.contextWindow.toLocaleString()}</b>
        </span>
        <span>
          {t("Max output")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.maxTokens.toLocaleString()}</b>
        </span>
        <span>
          {t("Reasoning")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.reasoning ? t("Supported") : t("Not supported")}</b>
        </span>
      </div>

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
    </div>
  );
}
