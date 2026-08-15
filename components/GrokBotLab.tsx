"use client";

/**
 * GrokBotLab — full customization modal for the sidebar GrokBot companion.
 *
 * Left column: live preview (pointer-following gaze + blink) plus the six
 * jello quick actions. Right column (scrollable): shape / body part /
 * accessory pickers, all 25 expressions (paged), and all 39 states grouped by
 * category (tabs + paging). Every pick writes to the shared grokbot store, so
 * the sidebar stage updates live behind the modal. Auto-tour cycles through
 * all states via the store's module-level timer.
 *
 * Bot body color is intentionally NOT exposed here — it tracks the active
 * theme accent (see `--bot-color: var(--accent)` in globals.css) and updates
 * automatically when the user switches theme.
 *
 * Vendored from https://github.com/zhulin025/LaoA-GrokBot (MIT).
 */

import { useEffect, useRef, useState } from "react";
import { GrokBot, type GrokBotHandle } from "./GrokBot";
import {
  useGrokbotConfig,
  setGrokbotConfig,
  randomizeGrokbot,
} from "@/lib/grokbot-store";
import {
  GROKBOT_EXPRESSIONS,
  GROKBOT_GROUPS,
  GROKBOT_SHAPES,
  GROKBOT_PARTS,
  GROKBOT_ACCESSORIES,
  GROKBOT_STATE_NAMES,
  GROKBOT_GROUP_NAMES,
  GROKBOT_QUICK_ACTIONS,
  type GrokExpression,
  type GrokPoint,
} from "@/lib/grokbot-data";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { Tooltip } from "./Tooltip";

const EXPR_PER_PAGE = 5;
const STATE_PER_PAGE = 6;

function ringPreviewPath(expr: GrokExpression): string {
  const [left, right] = expr;
  const path = (ring: readonly GrokPoint[]) =>
    "M" + ring.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L") + "Z";
  return path(left) + path(right);
}

interface Props {
  onClose: () => void;
}

export function GrokBotLab({ onClose }: Props) {
  const { t, locale } = useI18n();
  const config = useGrokbotConfig();
  const botRef = useRef<GrokBotHandle>(null);
  const { requestClose, backdropStyle, panelStyle } = useModalAnimation({
    isOpen: true,
    onClose,
  });

  const [exprPage, setExprPage] = useState(0);
  const [groupIndex, setGroupIndex] = useState(0);
  const [statePage, setStatePage] = useState(0);

  const stateName = locale === "zh"
    ? (GROKBOT_STATE_NAMES[config.stateKey] ?? config.stateKey)
    : config.stateKey;
  // Bot body color always tracks the active theme accent (see
  // `--bot-color: var(--accent)` in globals.css). All preview swatches in
  // this modal use the same token so the preview matches the rendered bot.
  const BOT_TINT = "var(--accent)";

  // ESC to close (same as other modals) — routes through requestClose so
  // the leaving animation plays before the modal unmounts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const groupKeys = Object.keys(GROKBOT_GROUPS);
  const groupName = (key: string) =>
    locale === "zh" ? (GROKBOT_GROUP_NAMES[key] ?? key) : key;
  const statesInGroup = GROKBOT_GROUPS[groupKeys[groupIndex]] ?? [];
  const statePages = Math.max(1, Math.ceil(statesInGroup.length / STATE_PER_PAGE));
  const exprPages = Math.ceil(GROKBOT_EXPRESSIONS.length / EXPR_PER_PAGE);

  const togglePart = (id: string) => {
    const has = config.parts.includes(id);
    setGrokbotConfig({ parts: has ? config.parts.filter((p) => p !== id) : [...config.parts, id] });
  };

  const toggleAccessory = (id: string) => {
    const has = config.accessories.includes(id);
    setGrokbotConfig({
      accessories: has ? config.accessories.filter((a) => a !== id) : [...config.accessories, id],
    });
  };

  const handleRandomize = () => {
    randomizeGrokbot();
    const action = GROKBOT_QUICK_ACTIONS[Math.floor(Math.random() * GROKBOT_QUICK_ACTIONS.length)];
    botRef.current?.playQuickAction(action.id);
  };

  const btnBase: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    fontSize: 12,
  };

  return (
    <div
      style={backdropStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        style={{
          ...panelStyle,
          width: 860,
          maxWidth: "96vw",
          height: "86vh",
          background: "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>
            {t("Pi Bot Lab")}
            <span
              style={{
                marginLeft: 10,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: config.autoPlay ? "var(--accent)" : "var(--text-dim)",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                transition: "color 0.2s ease",
              }}
            >
              GB—{String(config.expression).padStart(2, "0")} ·
              {config.autoPlay && (
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    animation: "grokbot-beacon 1.2s ease-in-out infinite",
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                key={config.autoPlay ? config.stateKey : "static"}
                style={
                  config.autoPlay
                    ? { animation: "grok-tour-name-in 240ms ease-out" }
                    : undefined
                }
              >
                {stateName}
              </span>
            </span>
          </h2>
          <Tooltip content={t("Cycle through all states automatically")}>
            <button
              type="button"
              role="switch"
              aria-checked={config.autoPlay}
              onClick={() => setGrokbotConfig({ autoPlay: !config.autoPlay })}
              className="grok-tour-toggle"
            >
              <svg
                width="11" height="11" viewBox="0 0 24 24"
                fill="currentColor" aria-hidden
              >
                <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.9l11.2-6.86c.64-.4.64-1.4 0-1.8L9.56 4.24A1.05 1.05 0 0 0 8 5.14Z" />
              </svg>
              {t("Auto tour")}
              <span className="grok-tour-switch" aria-hidden />
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={handleRandomize}
            style={{ ...btnBase, padding: "4px 12px", borderColor: "var(--border)", display: "flex", alignItems: "center", gap: 5 }}
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22" />
              <path d="m18 2 4 4-4 4" />
              <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
              <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
              <path d="m18 14 4 4-4 4" />
            </svg>
            {t("Randomize")}
          </button>
          <Tooltip content={t("Source repository")}>
            <a
              href="https://github.com/zhulin025/LaoA-GrokBot"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub · zhulin025/LaoA-GrokBot"
              style={{
                ...btnBase,
                padding: "4px 10px",
                display: "flex",
                alignItems: "center",
                textDecoration: "none",
              }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                <path d="M9 18c-4.51 2-5-2-7-2" />
              </svg>
            </a>
          </Tooltip>
          <button
            type="button"
            onClick={requestClose}
            style={{ ...btnBase, padding: "4px 12px" }}
          >
            {t("Close")}
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Preview column */}
          <div
            style={{
              width: 300,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "12px 16px",
              borderRight: "1px solid var(--border)",
              background: "var(--bg-subtle)",
            }}
          >
            <GrokBot ref={botRef} size={236} />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 6,
                width: "100%",
              }}
            >
              {GROKBOT_QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => botRef.current?.playQuickAction(action.id)}
                  style={{ ...btnBase, padding: "6px 4px", fontSize: 11 }}
                >
                  {action.name}
                </button>
              ))}
            </div>
          </div>

          {/* Config column */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
              padding: "12px 16px 20px",
            }}
          >
            {/* Body color is locked to the active theme accent; no picker. */}

            {/* Shape */}
            <Section title={t("Shape")}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {GROKBOT_SHAPES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.name}
                    aria-label={s.name}
                    aria-pressed={config.shapeId === s.id}
                    onClick={() => setGrokbotConfig({ shapeId: s.id })}
                    style={{
                      width: 46,
                      height: 46,
                      padding: 4,
                      borderRadius: 8,
                      background: "transparent",
                      border: config.shapeId === s.id ? "1px solid var(--text)" : "1px solid var(--border)",
                      cursor: "pointer",
                    }}
                  >
                    <svg viewBox="0 0 229 229" style={{ width: "100%", height: "100%" }} aria-hidden>
                      <path d={s.path} fill={BOT_TINT} />
                      <ellipse cx="87" cy="102" rx="9" ry="21" fill="var(--bg)" />
                      <ellipse cx="143" cy="102" rx="9" ry="21" fill="var(--bg)" />
                    </svg>
                  </button>
                ))}
              </div>
            </Section>

            {/* Parts + accessories */}
            <Section title={t("Body parts")}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {GROKBOT_PARTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={config.parts.includes(p.id)}
                    onClick={() => togglePart(p.id)}
                    style={{
                      ...btnBase,
                      padding: "6px 10px",
                      borderColor: config.parts.includes(p.id) ? BOT_TINT : "var(--border)",
                      color: config.parts.includes(p.id) ? BOT_TINT : "var(--text-muted)",
                      background: config.parts.includes(p.id) ? "var(--bg-hover)" : "transparent",
                    }}
                  >
                    {p.icon} {p.name}
                  </button>
                ))}
              </div>
            </Section>

            <Section title={t("Accessories")}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {GROKBOT_ACCESSORIES.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={config.accessories.includes(a.id)}
                    onClick={() => toggleAccessory(a.id)}
                    style={{
                      ...btnBase,
                      padding: "6px 10px",
                      borderColor: config.accessories.includes(a.id) ? BOT_TINT : "var(--border)",
                      color: config.accessories.includes(a.id) ? BOT_TINT : "var(--text-muted)",
                      background: config.accessories.includes(a.id) ? "var(--bg-hover)" : "transparent",
                    }}
                  >
                    {a.icon} {a.name}
                  </button>
                ))}
              </div>
            </Section>

            {/* Expressions */}
            <Section
              title={t("All expressions")}
              subtitle={`${exprPage + 1} / ${exprPages}`}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {GROKBOT_EXPRESSIONS.slice(exprPage * EXPR_PER_PAGE, (exprPage + 1) * EXPR_PER_PAGE).map((expr, i) => {
                  const index = exprPage * EXPR_PER_PAGE + i;
                  return (
                    <button
                      key={index}
                      type="button"
                      aria-pressed={config.expression === index}
                      onClick={() => setGrokbotConfig({ expression: index })}
                      style={{
                        ...btnBase,
                        padding: "4px 2px",
                        borderColor: config.expression === index ? "var(--text)" : "var(--border)",
                        background: config.expression === index ? "var(--bg-hover)" : "transparent",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      <svg viewBox="0 0 229 229" style={{ width: 40, height: 40 }} aria-hidden>
                        <path d={ringPreviewPath(expr)} fill={BOT_TINT} />
                      </svg>
                      <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
                        {String(index).padStart(2, "0")}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Pager
                page={exprPage}
                pages={exprPages}
                onPrev={() => setExprPage((p) => Math.max(0, p - 1))}
                onNext={() => setExprPage((p) => Math.min(exprPages - 1, p + 1))}
              />
            </Section>

            {/* States */}
            <Section title={t("All states")}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {groupKeys.map((key, i) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={i === groupIndex}
                    onClick={() => {
                      setGroupIndex(i);
                      setStatePage(0);
                    }}
                    style={{
                      ...btnBase,
                      padding: "4px 12px",
                      borderRadius: 99,
                      background: i === groupIndex ? "var(--text)" : "transparent",
                      color: i === groupIndex ? "var(--bg)" : "var(--text-muted)",
                      borderColor: "var(--border)",
                    }}
                  >
                    {groupName(key)}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {statesInGroup.slice(statePage * STATE_PER_PAGE, (statePage + 1) * STATE_PER_PAGE).map((stateKey) => {
                  const active = config.stateKey === stateKey;
                  const name = locale === "zh" ? (GROKBOT_STATE_NAMES[stateKey] ?? stateKey) : stateKey;
                  return (
                    <button
                      key={stateKey}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setGrokbotConfig({ stateKey })}
                      style={{
                        ...btnBase,
                        padding: "6px 10px",
                        textAlign: "left",
                        borderColor: active ? "var(--text)" : "var(--border)",
                        background: active ? "var(--bg-hover)" : "transparent",
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{name}</span>
                      <span style={{ display: "block", fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                        {stateKey}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Pager
                page={statePage}
                pages={statePages}
                onPrev={() => setStatePage((p) => Math.max(0, p - 1))}
                onNext={() => setStatePage((p) => Math.min(statePages - 1, p + 1))}
              />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          {title}
        </h3>
        {subtitle && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Pager({
  page,
  pages,
  onPrev,
  onNext,
}: {
  page: number;
  pages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 0}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "transparent",
          color: "var(--text-muted)",
          cursor: page <= 0 ? "default" : "pointer",
          fontSize: 11,
          padding: "3px 10px",
          opacity: page <= 0 ? 0.4 : 1,
        }}
      >
        ←
      </button>
      <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        {page + 1} / {pages}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= pages - 1}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "transparent",
          color: "var(--text-muted)",
          cursor: page >= pages - 1 ? "default" : "pointer",
          fontSize: 11,
          padding: "3px 10px",
          opacity: page >= pages - 1 ? 0.4 : 1,
        }}
      >
        →
      </button>
    </div>
  );
}
