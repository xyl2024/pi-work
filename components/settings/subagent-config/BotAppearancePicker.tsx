"use client";

/**
 * BotAppearancePicker — edits one subagent profile's Pi Bot appearance.
 *
 * A compact, controlled version of the GrokBot Lab: the same shapes, body
 * parts, accessories, expressions and states, with a live preview rendered by
 * a *controlled* `<GrokBot>` (so it never touches the user's own companion in
 * `lib/client/grokbot-store`).
 */

import { useMemo, useState } from "react";
import { GrokBot } from "@/components/grokbot/GrokBot";
import {
  GROKBOT_ACCESSORIES,
  GROKBOT_EXPRESSIONS,
  GROKBOT_GROUPS,
  GROKBOT_GROUP_NAMES,
  GROKBOT_PARTS,
  GROKBOT_SHAPES,
  GROKBOT_STATE_NAMES,
  type GrokExpression,
  type GrokPoint,
} from "@/lib/client/grokbot-data";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentBotAppearance } from "@/lib/shared/subagent";

const EXPR_PER_PAGE = 5;

function ringPreviewPath(expr: GrokExpression): string {
  const [left, right] = expr;
  const path = (ring: readonly GrokPoint[]) =>
    "M" + ring.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L") + "Z";
  return path(left) + path(right);
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: "4px 9px",
        borderRadius: 6,
        fontSize: 11,
        cursor: "pointer",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--bg-hover)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-muted)",
      }}
    >
      {label}
    </button>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, marginBottom: 6 }}>
      {children}
    </div>
  );
}

export function BotAppearancePicker({
  value,
  onChange,
}: {
  value: SubagentBotAppearance;
  onChange: (next: SubagentBotAppearance) => void;
}) {
  const { t, locale } = useI18n();
  const [exprPage, setExprPage] = useState(0);

  const groupKeys = useMemo(() => Object.keys(GROKBOT_GROUPS), []);
  const exprPages = Math.max(1, Math.ceil(GROKBOT_EXPRESSIONS.length / EXPR_PER_PAGE));
  const pageExprs = GROKBOT_EXPRESSIONS.slice(
    exprPage * EXPR_PER_PAGE,
    (exprPage + 1) * EXPR_PER_PAGE,
  );

  const patch = (part: Partial<SubagentBotAppearance>) => onChange({ ...value, ...part });
  const toggle = (key: "parts" | "accessories", id: string) => {
    const has = value[key].includes(id);
    patch({ [key]: has ? value[key].filter((item) => item !== id) : [...value[key], id] } as Partial<SubagentBotAppearance>);
  };
  const stateName = (key: string) => (locale === "zh" ? (GROKBOT_STATE_NAMES[key] ?? key) : key);

  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      <div style={{ flexShrink: 0, width: 150 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 6, background: "var(--bg)" }}>
          <GrokBot
            appearance={value}
            size={136}
            interactive
            onAppearanceChange={(next) => patch(next)}
          />
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <Caption>{t("Shape")}</Caption>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {GROKBOT_SHAPES.map((shape) => (
              <ToggleChip
                key={shape.id}
                label={locale === "zh" ? shape.name : shape.id}
                active={value.shapeId === shape.id}
                onClick={() => patch({ shapeId: shape.id })}
              />
            ))}
          </div>
        </div>

        <div>
          <Caption>{t("All states")}</Caption>
          <select
            value={value.stateKey}
            onChange={(event) => patch({ stateKey: event.target.value })}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
          >
            {groupKeys.map((group) => (
              <optgroup
                key={group}
                label={locale === "zh" ? (GROKBOT_GROUP_NAMES[group] ?? group) : group}
              >
                {GROKBOT_GROUPS[group].map((state) => (
                  <option key={state} value={state}>{stateName(state)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <Caption>{t("Body parts")}</Caption>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {GROKBOT_PARTS.map((part) => (
                <ToggleChip
                  key={part.id}
                  label={locale === "zh" ? part.name : part.id}
                  active={value.parts.includes(part.id)}
                  onClick={() => toggle("parts", part.id)}
                />
              ))}
            </div>
          </div>
          <div>
            <Caption>{t("Accessories")}</Caption>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {GROKBOT_ACCESSORIES.map((accessory) => (
                <ToggleChip
                  key={accessory.id}
                  label={locale === "zh" ? accessory.name : accessory.id}
                  active={value.accessories.includes(accessory.id)}
                  onClick={() => toggle("accessories", accessory.id)}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <Caption>{t("Expression")}</Caption>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                {exprPage + 1}/{exprPages}
              </span>
              <ToggleChip label="‹" active={false} onClick={() => setExprPage((p) => (p - 1 + exprPages) % exprPages)} />
              <ToggleChip label="›" active={false} onClick={() => setExprPage((p) => (p + 1) % exprPages)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {pageExprs.map((expr, index) => {
              const exprIndex = exprPage * EXPR_PER_PAGE + index;
              const active = value.expression === exprIndex;
              return (
                <button
                  key={exprIndex}
                  type="button"
                  aria-pressed={active}
                  onClick={() => patch({ expression: exprIndex })}
                  title={`${exprIndex}`}
                  style={{
                    width: 44,
                    height: 44,
                    padding: 0,
                    borderRadius: 6,
                    cursor: "pointer",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    background: active ? "var(--bg-hover)" : "transparent",
                  }}
                >
                  <svg viewBox="0 0 229 229" width="38" height="38" aria-hidden="true">
                    <path d={ringPreviewPath(expr)} fill="var(--accent)" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
