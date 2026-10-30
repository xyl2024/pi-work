"use client";

import { useEffect, useState } from "react";
import { InlineLoader, type InlineLoaderVariant } from "generative-loaders";
import { useI18n } from "@/hooks/useI18n";

type LoadingVariant = InlineLoaderVariant | "dot-pulse";

function DotPulseLoader() {
  return (
    <span
      data-loading-dot-pulse
      aria-hidden="true"
      style={{ display: "inline-flex", alignItems: "center", gap: 3, width: 18, height: 18 }}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "var(--accent)",
            animation: "loading-dot-pulse 1.2s ease-in-out infinite",
            animationDelay: `${index * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function ElapsedClock({ since }: { since: number }) {
  const { t } = useI18n();
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - since));

  useEffect(() => {
    const tick = () => setElapsedMs(Math.max(0, Date.now() - since));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);

  return (
    <span
      data-loading-elapsed
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: "var(--text-muted)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {t("Elapsed: {time}", { time: formatElapsed(elapsedMs) })}
    </span>
  );
}

export default function LoadingState({
  label = "Churning",
  variant = "spark",
  elapsedSince = null,
}: {
  label?: string;
  variant?: LoadingVariant;
  elapsedSince?: number | null;
}) {
  return (
    <div
      className="flex w-fit items-center gap-2.5"
      role="status"
      aria-live="polite"
    >
      {variant === "dot-pulse" ? (
        <DotPulseLoader />
      ) : (
        <InlineLoader variant={variant} size={18} color="var(--accent)" />
      )}
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
        {label}
      </span>
      {typeof elapsedSince === "number" && <ElapsedClock since={elapsedSince} />}
    </div>
  );
}
