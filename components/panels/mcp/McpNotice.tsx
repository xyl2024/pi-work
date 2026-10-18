"use client";

import { type ReactNode } from "react";

/** The panel's inline notice strip: an amber "be careful" or a red "error". */
export function McpNotice({ tone, children }: { tone: "warn" | "error"; children: ReactNode }) {
  const color = tone === "error" ? "var(--error)" : "var(--text-muted)";
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.55,
        color,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
        borderRadius: 6,
        padding: "8px 10px",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}
