"use client";

import { useI18n } from "@/hooks/useI18n";
import { ModelCardShell, ReasoningBadge } from "./ModelCard";
import type { ModelEntry } from "./types";

/**
 * One custom model (`ModelEntry` under a user-defined provider) rendered as a
 * card, reusing the same shell as the runtime-catalog `ModelCard` so both
 * grids look identical.
 *
 * Unlike the runtime card it does not expand — clicking opens that entry's
 * edit view (the right chevron hints at the navigation). Fields are all
 * optional on `ModelEntry`, so the summary only lists what is set.
 */
export function ModelEntryCard({
  model,
  providerIcon,
  onOpen,
}: {
  model: ModelEntry;
  /** The provider-level icon id chosen in ProviderDetail, used when the model has none. */
  providerIcon?: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const title = model.name || model.id || t("new model");
  const seed = model.id || model.name || providerIcon || "?";
  const subtitle = model.id && model.name ? model.id : undefined;

  const stats: React.ReactNode[] = [];
  if (model.api) {
    stats.push(
      <span key="api">
        {t("API")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.api}</b>
      </span>,
    );
  }
  if (typeof model.contextWindow === "number") {
    stats.push(
      <span key="ctx">
        {t("Context window")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.contextWindow.toLocaleString()}</b>
      </span>,
    );
  }
  if (typeof model.maxTokens === "number") {
    stats.push(
      <span key="out">
        {t("Max output")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{model.maxTokens.toLocaleString()}</b>
      </span>,
    );
  }
  if (model.reasoning) {
    stats.push(
      <span key="reason">
        {t("Reasoning")}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{t("Supported")}</b>
      </span>,
    );
  }

  return (
    <ModelCardShell
      iconId={model.icon ?? providerIcon}
      seed={seed}
      title={title}
      subtitle={subtitle}
      badge={model.reasoning ? <ReasoningBadge /> : undefined}
      onClick={onOpen}
      summary={
        stats.length > 0 ? (
          stats
        ) : (
          <span style={{ color: "var(--text-dim)" }}>{t("No metadata")}</span>
        )
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
          style={{ flexShrink: 0, color: "var(--text-dim)" }}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
      }
    />
  );
}
