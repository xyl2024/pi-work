/**
 * Renders a cron expression alongside its natural-language description,
 * with a tooltip showing the next few trigger times. The natural language
 * is what the user actually scans in list rows; the raw cron is the
 * source of truth they can copy/edit. Showing both side-by-side means
 * the user never has to read cron to understand "what does this do?".
 */

import { useEffect, useMemo, useState } from "react";
import { Cron } from "croner";
import { Tooltip } from "@/components/Tooltip";
import { useI18n } from "@/hooks/useI18n";
import { cronHumanize, isOnceCron } from "./utils";

interface Props {
  cron: string;
  /** Max number of upcoming trigger times to preview in the tooltip. */
  previewCount?: number;
  /** Render the raw cron in a monospace code chip. */
  showCode?: boolean;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

function nextRuns(cron: string, count: number): number[] {
  try {
    const c = new Cron(cron);
    const out: number[] = [];
    let cursor = new Date();
    for (let i = 0; i < count; i++) {
      const n = c.nextRun(cursor);
      if (!n) break;
      out.push(n.getTime());
      cursor = n;
    }
    return out;
  } catch {
    return [];
  }
}

export function CronHumanizer({ cron, previewCount = 3, showCode = false }: Props) {
  const { t, locale } = useI18n();
  const human = useMemo(() => cronHumanize(cron, locale), [cron, locale]);
  const upcoming = useMemo(() => nextRuns(cron, previewCount), [cron, previewCount]);
  const isValid = upcoming.length > 0;
  // 单次 cron 执行后 nextRun() 返回 null —— 不是无效，是已经过期/执行完毕
  const doneOnce = isOnceCron(cron) && !isValid;

  // Live-update the human preview so "in 2h" stays accurate as time passes
  // while the modal is open. Refresh every 30s; cheap.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const previewBlock = (
    <div style={{ padding: "8px 10px", maxWidth: 260, lineHeight: 1.55 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
        {upcoming.length > 0 ? t("Next run") : doneOnce ? t("This time has passed") : t("Invalid cron expression")}
      </div>
      {upcoming.map((ts) => (
        <div key={ts} style={{ fontSize: 11, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
          {formatTs(ts)}
        </div>
      ))}
      {showCode && isValid && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
          {cron}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip content={previewBlock} side="bottom" delayDuration={150}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: isValid ? "var(--text-muted)" : doneOnce ? "var(--text-dim)" : "var(--error)",
          cursor: "help",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{human}</span>
        {showCode && isValid && (
          <code
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 3,
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              flexShrink: 0,
            }}
          >
            {cron}
          </code>
        )}
      </span>
    </Tooltip>
  );
}