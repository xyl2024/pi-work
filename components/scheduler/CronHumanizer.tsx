import { useEffect, useMemo, useState } from "react";
import { Cron } from "croner";
import { Tooltip } from "@/components/ui/Tooltip";
import { useI18n } from "@/hooks/useI18n";
import { cronHumanize, isOnceCron } from "./utils";

interface Props {
  cron: string;
  previewCount?: number;
  showCode?: boolean;
  timezone?: string;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

function nextRuns(cron: string, count: number, timezone?: string): number[] {
  try {
    const c = new Cron(cron, timezone ? { timezone } : undefined);
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

export function CronHumanizer({ cron, previewCount = 3, showCode = false, timezone }: Props) {
  const { t, locale } = useI18n();
  const human = useMemo(() => cronHumanize(cron, locale), [cron, locale]);
  const upcoming = useMemo(() => nextRuns(cron, previewCount, timezone), [cron, previewCount, timezone]);
  const isValid = upcoming.length > 0;
  const doneOnce = isOnceCron(cron) && !isValid;

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
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", paddingTop: 6 }}>
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