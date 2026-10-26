"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import type { DangerousRuleSetSnapshot } from "@/lib/shared/dangerous-commands";
import type { DangerousPatternRule } from "@/lib/shared/config-types";
import { SETTINGS_RADIUS } from "../controls";
import { useSettingsPageData } from "../use-page-data";

/** One read of the effective set; the modal's page-data cache keeps it for the modal's lifetime. */
async function loadRuleSet(): Promise<DangerousRuleSetSnapshot> {
  const response = await fetch("/api/dangerous-commands", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as DangerousRuleSetSnapshot & {
    error?: string;
  };
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

const ROW_STYLE = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  padding: "7px 10px",
  borderTop: "1px solid var(--border)",
} as const;

/**
 * One built-in rule, read-only: the name the confirmation dialog shows, the
 * pattern as written (monospace, truncated — a long regex must not widen the
 * modal) and whether it ignores case.
 */
function RuleRow({ rule, first }: { rule: DangerousPatternRule; first: boolean }) {
  const { t } = useI18n();
  return (
    <div style={first ? { ...ROW_STYLE, borderTop: "none" } : ROW_STYLE}>
      <span
        title={rule.name}
        style={{
          flexShrink: 0,
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 12,
          color: "var(--text)",
        }}
      >
        {rule.name}
      </span>
      <code
        title={rule.pattern}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        {rule.pattern}
      </code>
      <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)" }}>
        {rule.ignoreCase ? t("Ignore case") : t("Case-sensitive")}
      </span>
    </div>
  );
}

/**
 * Settings → Agent → Dangerous commands (ADR-0020).
 *
 * The page makes the confirmation gate visible without turning it into a
 * switch. What it lists is the platform's **built-in** floor, read from
 * `/api/dangerous-commands` — the same effective set the gate assembles, not a
 * client-side copy — so the Windows-only PowerShell rules appear on Windows
 * and stay out of the way everywhere else.
 *
 * Two boundaries the page must state, because both are easy to misread:
 * clearing the user's own rules does not turn the built-ins off, and a match is
 * a confirmation prompt, not a block.
 *
 * Self-protection (the code-level hard block in `lib/server/self-protection.ts`)
 * deliberately does not appear here: anything listed on a settings page reads
 * as configurable, and that one is not.
 */
export function DangerousCommandsSection({ pageCache }: { pageCache: SettingsPageDataCache }) {
  const { t } = useI18n();
  const { data, loading, error } = useSettingsPageData(
    pageCache,
    "dangerous-commands",
    loadRuleSet,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {t("Built-in rules")}
        </h3>
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t(
            "These apply on this platform and cannot be turned off. Clearing your own rules does not turn them off. A match asks for confirmation — it does not block the command.",
          )}
        </p>
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("Loading...")}</div>
      ) : error ? (
        <div style={{ fontSize: 11, color: "var(--error)" }}>{error}</div>
      ) : (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: SETTINGS_RADIUS,
            overflow: "hidden",
            background: "var(--bg)",
          }}
        >
          {(data?.builtins ?? []).map((rule, index) => (
            <RuleRow key={`${rule.name}-${index}`} rule={rule} first={index === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
