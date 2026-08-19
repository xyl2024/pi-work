"use client";

import { Tooltip } from "./Tooltip";
import { useI18n } from "@/hooks/useI18n";
import type { SlashResource } from "@/lib/slash-commands";

/**
 * Inline chip rendered above the textarea once the user has picked a
 * prompt/skill action from the slash menu. Shows the source badge
 * (skill gets a green chip, prompt/skill use the accent color) plus the
 * `/command` and a small remove button. Shift+Backspace on the textarea
 * is the keyboard equivalent of the remove button.
 */
export function SlashCommandHint({ resource, onRemove }: {
  resource: SlashResource;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        maxWidth: "100%", padding: "4px 8px",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 7, color: "var(--text-muted)", fontSize: 12,
      }}>
        <span style={{
          color: resource.source === "skill" ? "#059669" : "var(--accent)",
          fontWeight: 700, textTransform: "uppercase", fontSize: 10,
        }}>
          {resource.source}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          /{resource.command}
        </span>
        <Tooltip content={t("Remove")}>
          <button
            onClick={onRemove}
            style={{
              width: 16, height: 16, border: "none", background: "none",
              color: "var(--text-dim)", cursor: "pointer", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1.5" y1="1.5" x2="7.5" y2="7.5" /><line x1="7.5" y1="1.5" x2="1.5" y2="7.5" />
            </svg>
          </button>
        </Tooltip>
      </span>
    </div>
  );
}
