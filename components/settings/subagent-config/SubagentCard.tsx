"use client";

import { GrokBot } from "@/components/grokbot/GrokBot";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentProfile } from "@/lib/shared/subagent";

/**
 * One subagent profile rendered as a card: its Pi Bot face, name, description
 * and a one-line summary of model / thinking / timeout / tool count.
 */
export function SubagentCard({
  profile,
  onEdit,
  onDelete,
}: {
  profile: SubagentProfile;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const modelLabel = profile.model ? `${profile.model.provider}/${profile.model.modelId}` : t("Inherit parent model");
  const timeoutMinutes = Math.round(profile.timeoutMs / 60_000);

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: 10,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-panel)",
      }}
    >
      <div style={{ flexShrink: 0, width: 52 }} aria-hidden="true">
        <GrokBot appearance={profile.bot} size={52} interactive={false} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {profile.name}
          </span>
          {profile.builtin && (
            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, border: "1px solid var(--border)", color: "var(--text-dim)" }}>
              {t("Built-in")}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {profile.description}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, fontSize: 10, color: "var(--text-dim)", flexWrap: "wrap" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{modelLabel}</span>
          <span>·</span>
          <span>{profile.thinkingLevel}</span>
          <span>·</span>
          <span>{t("{n} min", { n: timeoutMinutes })}</span>
          <span>·</span>
          <span>{t("{n} tools", { n: profile.tools.length })}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onEdit}
          style={{ padding: "3px 9px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "none", color: "var(--text)", cursor: "pointer" }}
        >
          {t("Edit")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          style={{ padding: "3px 9px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "none", color: "var(--error)", cursor: "pointer" }}
        >
          {t("Delete")}
        </button>
      </div>
    </div>
  );
}
