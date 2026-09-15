"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  formatCompositionPercent,
  formatEstimatedTokens,
  type ContextComposition,
} from "@/lib/shared/context-composition";
import { contextBucketRows, type ContextCompositionRow } from "@/lib/shared/context-composition-rows";
import { formatContextTokensK, formatContextWindowCompact } from "@/lib/shared/context-usage";
import {
  CONTEXT_BUCKET_COLORS,
  CONTEXT_BUCKET_LABELS,
  contextRowLabel,
} from "./context-composition-label";

interface Props {
  composition: ContextComposition;
  /** Model context window, for the `total / window` header readout. */
  contextWindow: number;
  /** The ring's total, used for the header while the composition itself has no
   *  anchor yet (the estimate landed before the next provider usage did). The
   *  rows then show local counts without percentages rather than inventing a
   *  share. */
  fallbackTotalTokens: number | null;
  /** Space the popover may occupy above the ring. Measured by the trigger so the
   *  panel is never clipped by the chat window on short viewports. */
  maxHeight: number | null;
}

/** The fields a row needs to render — a bucket and a `ContextCompositionRow`
 *  both satisfy it, so the list renders top level and children with one
 *  component. */
type RowData = Pick<ContextCompositionRow, "id" | "localTokens" | "tokens" | "percent" | "children">;

/** A stacked-bar segment: one bucket (top level) or one of its rows (sub level). */
interface Segment {
  id: string;
  label: string;
  color: string;
  /** 0–1 alpha, used to tint a bucket's rows apart from each other. */
  opacity: number;
  value: number;
}

/** One row renders as `≈ 12.3K  6.2%` — the `≈` is the whole point of the
 *  panel (ADR-0005): the total is provider-exact, this is a local estimate, and
 *  the two must never look like the same kind of number. */
function formatRowTokens(row: RowData): string {
  return formatEstimatedTokens(row.tokens ?? row.localTokens);
}

function StackedBar({ segments, height, weight }: { segments: Segment[]; height: number; weight: number }) {
  // Nothing counted yet: an empty track, never a zero-width sliver soup.
  if (weight <= 0) {
    return (
      <div
        style={{ height, borderRadius: height / 2, background: "color-mix(in srgb, var(--text-muted) 18%, transparent)" }}
        aria-hidden
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        height,
        borderRadius: height / 2,
        overflow: "hidden",
        background: "color-mix(in srgb, var(--text-muted) 18%, transparent)",
      }}
      aria-hidden
    >
      {segments.map((segment) =>
        segment.value > 0 ? (
          <div
            key={segment.id}
            title={`${segment.label} ${formatEstimatedTokens(segment.value)}`}
            style={{ width: `${(segment.value / weight) * 100}%`, background: segment.color, opacity: segment.opacity }}
          />
        ) : null,
      )}
    </div>
  );
}

/** One row of the hierarchical list. A row with children renders as a button
 *  that toggles the next level; a leaf row is plain text. */
function CompositionRow({
  row,
  label,
  color,
  opacity,
  depth,
  expanded,
  onToggle,
  children,
}: {
  row: RowData;
  label: { text: string; mono: boolean };
  color: string;
  opacity: number;
  depth: number;
  expanded: boolean;
  onToggle: (() => void) | null;
  children?: ReactNode;
}) {
  const percent = row.percent === null ? null : `${formatCompositionPercent(row.percent)}%`;

  const content = (
    <>
      {onToggle ? (
        <svg
          width="9"
          height="9"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}
          aria-hidden
        >
          <polyline points="6 3 11 8 6 13" />
        </svg>
      ) : (
        <span style={{ width: 9, flexShrink: 0 }} />
      )}
      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: color, opacity }} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: label.mono ? "var(--font-mono)" : undefined,
        }}
      >
        {label.text}
      </span>
      <span style={{ flexShrink: 0, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
        {formatRowTokens(row)}
      </span>
      <span
        style={{
          flexShrink: 0,
          width: 44,
          textAlign: "right",
          color: "var(--text-dim)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {percent}
      </span>
    </>
  );

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: `3px 4px 3px ${4 + depth * 14}px`,
    background: "none",
    border: "none",
    borderRadius: 4,
    color: "var(--text)",
    font: "inherit",
    fontSize: 11,
    textAlign: "left",
  };

  return (
    <div>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          style={{ ...rowStyle, cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          {content}
        </button>
      ) : (
        <div style={rowStyle}>{content}</div>
      )}
      {children}
    </div>
  );
}

/** A row's second level: its rows, plus a slim stacked bar so the expanded
 *  bucket still reads as one whole. Recursive, so the base-prompt row can offer
 *  a third level (its own prose + `Available tools` + `Guidelines`). */
function ChildRows({
  rows,
  color,
  depth,
  expandedKeys,
  toggleKey,
}: {
  rows: ContextCompositionRow[];
  color: string;
  depth: number;
  /** Keys of the rows whose own children are open. */
  expandedKeys: Record<string, boolean>;
  toggleKey: (key: string) => void;
}) {
  const { t } = useI18n();
  const weight = rows.reduce((sum, row) => sum + (row.tokens ?? row.localTokens), 0);
  return (
    <div style={{ margin: "2px 0 4px" }}>
      {/* Align the sub-bar with the swatches of the rows it summarizes. */}
      <div style={{ paddingLeft: 4 + depth * 14 + 15 }}>
        <StackedBar
          segments={rows.map((row, index) => ({
            id: row.id,
            label: contextRowLabel(row.id, t).text,
            color,
            opacity: Math.max(0.35, 1 - index * 0.12),
            value: row.tokens ?? row.localTokens,
          }))}
          weight={weight}
          height={5}
        />
      </div>
      {rows.map((row, index) => {
        const key = `${depth}:${index}:${row.id}`;
        const hasChildren = row.children.length > 0;
        const expanded = hasChildren && !!expandedKeys[key];
        return (
          <CompositionRow
            key={key}
            row={row}
            label={contextRowLabel(row.id, t)}
            color={color}
            // Rows of one bucket share its hue and are separated by alpha, so
            // the sub-bar and the swatches stay legible without seven more
            // colors per bucket.
            opacity={Math.max(0.35, 1 - index * 0.12)}
            depth={depth}
            expanded={expanded}
            onToggle={hasChildren ? () => toggleKey(key) : null}
          >
            {expanded && (
              <ChildRows
                rows={row.children}
                color={color}
                depth={depth + 1}
                expandedKeys={expandedKeys}
                toggleKey={toggleKey}
              />
            )}
          </CompositionRow>
        );
      })}
    </div>
  );
}

/**
 * The click-opened "what is this context made of" panel (ADR-0005).
 *
 * Two levels by default — the four buckets, each expandable into its sources —
 * plus a third level under the base-prompt row so the prompt's tool list and
 * guidelines can keep the Context panel's anchor names. Everything it prints is
 * derived from the shared composition: the total is the provider's number and
 * carries no decoration, every classified number carries `≈`, and the footer
 * says why.
 *
 * Positioning is the trigger's job: this component renders into a
 * `position: relative` wrapper next to the ring and pops upward, so it is never
 * clipped by the chat scroll container (the input bar lives outside it) and
 * needs no portal.
 */
export function ContextCompositionPopover({ composition, contextWindow, fallbackTotalTokens, maxHeight }: Props) {
  const { t } = useI18n();
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const toggleKey = (key: string) => setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));

  const total = composition.anchoredTotalTokens ?? fallbackTotalTokens;
  const buckets = composition.buckets.map((bucket) => ({
    bucket,
    color: CONTEXT_BUCKET_COLORS[bucket.id],
    rows: contextBucketRows(bucket),
    weight: bucket.tokens ?? bucket.localTokens,
  }));
  const weight = buckets.reduce((sum, entry) => sum + entry.weight, 0);

  return (
    <div
      role="dialog"
      aria-label={t("Context composition")}
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        right: 0,
        zIndex: 300,
        width: 340,
        maxWidth: "min(340px, calc(100vw - 24px))",
        maxHeight: maxHeight ?? "min(60vh, 460px)",
        overflowY: "auto",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px 7px",
        boxShadow: "0 -6px 24px rgba(0,0,0,0.18)",
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{t("Context composition")}</span>
        <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {total !== null && <span style={{ fontWeight: 600 }}>{formatContextTokensK(total)}</span>}
          <span style={{ color: "var(--text-dim)" }}> / {formatContextWindowCompact(contextWindow)}</span>
        </span>
      </div>

      <StackedBar
        segments={buckets.map(({ bucket, color, weight: bucketWeight }) => ({
          id: bucket.id,
          label: t(CONTEXT_BUCKET_LABELS[bucket.id]),
          color,
          opacity: 1,
          value: bucketWeight,
        }))}
        weight={weight}
        height={8}
      />

      <div style={{ marginTop: 6 }}>
        {buckets.map(({ bucket, color, rows }) => {
          // Expandable when there is more than one source to separate — or when
          // the single row is itself split (a custom prompt can be only the tool
          // list + guidelines, with no prose leaf of its own).
          const expandable = rows.length > 1 || rows.some((row) => row.children.length > 0);
          const expanded = expandable && !!expandedKeys[bucket.id];
          return (
            <CompositionRow
              key={bucket.id}
              row={{ id: bucket.id, localTokens: bucket.localTokens, tokens: bucket.tokens, percent: bucket.percent, children: [] }}
              label={{ text: t(CONTEXT_BUCKET_LABELS[bucket.id]), mono: false }}
              color={color}
              opacity={1}
              depth={0}
              expanded={expanded}
              onToggle={expandable ? () => toggleKey(bucket.id) : null}
            >
              {expanded && <ChildRows rows={rows} color={color} depth={1} expandedKeys={expandedKeys} toggleKey={toggleKey} />}
            </CompositionRow>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 6,
          paddingTop: 5,
          borderTop: "1px solid var(--border)",
          color: "var(--text-dim)",
          fontSize: 10,
          lineHeight: 1.45,
        }}
      >
        {t("The total comes from the model and is exact; the categories are local estimates.")}
      </div>
    </div>
  );
}
