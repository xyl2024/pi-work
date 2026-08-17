"use client";

import { useEffect, useState } from "react";
import { InlineLoader, type InlineLoaderVariant } from "generative-loaders";

function useElapsed() {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export default function LoadingState({
  label = "Churning",
  variant = "spark",
}: {
  label?: string;
  variant?: InlineLoaderVariant;
}) {
  const elapsed = useElapsed();

  return (
    <div
      className="flex w-fit items-center gap-2.5"
      role="status"
      aria-live="polite"
    >
      <InlineLoader variant={variant} size={18} color="var(--accent)" />
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-dim)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {elapsed}
      </span>
    </div>
  );
}
