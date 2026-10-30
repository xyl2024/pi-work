"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SlashResource } from "@/lib/shared/slash-commands";

export function SlashCommandMenu({
  items,
  activeIndex,
  onSelect,
}: {
  items: SlashResource[];
  activeIndex: number;
  onSelect: (item: SlashResource) => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) {
    return (
      <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-dim)" }}>
        {t("No matches")}
      </div>
    );
  }
  return (
    <>
      {items.map((item, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={`${item.source}:${item.command}:${item.path}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            style={{
              width: "100%", display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)",
              gap: 10, padding: "8px 10px",
              background: active ? "var(--bg-selected)" : "none",
              border: "none", borderBottom: "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
              color: active ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{
              alignSelf: "start", justifySelf: "start",
              padding: "2px 6px", borderRadius: 5,
              background: item.source === "skill" ? "rgba(5,150,105,0.10)" : "rgba(234,179,8,0.10)",
              color: item.source === "skill" ? "#059669" : "rgba(180,130,0,0.9)",
              fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            }}>
              {item.source}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                /{item.command}
              </span>
              {item.description && (
                <span style={{ display: "block", marginTop: 2, fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
      <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-dim)", textAlign: "right" }}>
        {t("↑↓ switch, ←→ page, Enter to pick")}
      </div>
    </>
  );
}
