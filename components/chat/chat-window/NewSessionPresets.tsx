"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";

const NEW_SESSION_PRESETS = [
  {
    key: "explore",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>,
    titleKey: "Explore this codebase",
    descKey: "Understand the project structure and how it fits together",
    promptKey: "Walk me through this codebase: overall architecture, key modules, entry points, and how they fit together.",
  },
  {
    key: "review",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /><path d="M8.5 11l2 2 3.5-3.5" /></svg>,
    titleKey: "Review my code",
    descKey: "Find bugs, smells, and improvements",
    promptKey: "Review the code for bugs, code smells, and improvements. Point out concrete issues with file paths and line numbers.",
  },
  {
    key: "debug",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="6" /><path d="M12 7V4" /><path d="M8.5 5.5 7 4" /><path d="M15.5 5.5 17 4" /><path d="M9 13h.01" /><path d="M15 13h.01" /></svg>,
    titleKey: "Help me debug",
    descKey: "Reproduce, isolate, and fix a bug",
    promptKey: "Help me debug this issue: reproduce it, find the root cause, and fix it.",
  },
  {
    key: "tests",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2v6.5L4.5 18.5a2 2 0 0 0 1.8 2.9h11.4a2 2 0 0 0 1.8-2.9L14 8.5V2" /><path d="M8.5 2h7" /><path d="M7 16h10" /></svg>,
    titleKey: "Write tests",
    descKey: "Add unit tests for a module",
    promptKey: "Write unit tests for this module, covering the main paths and edge cases.",
  },
  {
    key: "optimize",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>,
    titleKey: "Optimize performance",
    descKey: "Profile and speed up slow code",
    promptKey: "Profile this code, find the performance bottlenecks, and suggest concrete optimizations.",
  },
  {
    key: "docs",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>,
    titleKey: "Document this project",
    descKey: "Generate a structured wiki from the source",
    promptKey: "Generate structured project documentation (a wiki) from the source code.",
  },
] as const;

export function NewSessionPresets({ onPickPrompt }: { onPickPrompt: (prompt: string) => void }) {
  const { t } = useI18n();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <div className="grid w-full max-w-[820px] grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {NEW_SESSION_PRESETS.map((preset) => {
        const isHovered = hoveredKey === preset.key;
        const isSqueezed = hoveredKey !== null && !isHovered;

        return (
          <button
            key={preset.key}
            type="button"
            onClick={() => onPickPrompt(t(preset.promptKey))}
            onMouseEnter={() => setHoveredKey(preset.key)}
            onMouseLeave={() => setHoveredKey((cur) => (cur === preset.key ? null : cur))}
            onFocus={() => setHoveredKey(preset.key)}
            onBlur={() => setHoveredKey((cur) => (cur === preset.key ? null : cur))}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "12px 14px",
              background: isHovered ? "var(--bg-hover)" : "var(--bg-subtle)",
              border: `1px solid ${isHovered ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 12,
              cursor: "pointer",
              textAlign: "left",
              opacity: isSqueezed ? 0.55 : 1,
              transform: isHovered ? "scale(1.06)" : isSqueezed ? "scale(0.94)" : "scale(1)",
              transformOrigin: "center center",
              zIndex: isHovered ? 2 : 0,
              boxShadow: isHovered ? "0 6px 20px -8px rgba(0,0,0,0.18)" : "none",
              transition:
                "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, background 0.15s, border-color 0.15s, box-shadow 0.25s ease",
              willChange: "transform, opacity",
            }}
          >
            <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2, display: "flex" }}>{preset.icon}</span>
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text)",
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t(preset.titleKey)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  lineHeight: 1.45,
                  display: "-webkit-box",
                  WebkitLineClamp: isHovered ? 3 : 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {t(preset.descKey)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
