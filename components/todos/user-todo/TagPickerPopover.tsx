"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * Suggestion list anchored beneath CreateTodoInput. Lists matching existing
 * tags plus an optional "Create tag #xxx" row when the typed query doesn't
 * collide. Mouse and keyboard interactions are owned by the parent so the
 * input keeps focus and cursor placement authority.
 */
export function TagPickerPopover({
  items,
  activeIndex,
  onHover,
  onSelect,
  onMouseDownOutside,
}: {
  items: Array<{ kind: "existing" | "create"; tag: string; color?: string }>;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  onMouseDownOutside: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onMouseDownOutside();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onMouseDownOutside]);

  return (
    <div
      ref={ref}
      role="listbox"
      data-scroll-inset
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        zIndex: 10,
        maxHeight: 200,
        overflowY: "auto",
        padding: 4,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
      }}
    >
      {items.map((item, i) => {
        const isActive = i === activeIndex;
        const isCreate = item.kind === "create";
        return (
          <div
            key={`${item.kind}-${item.tag}`}
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              // mousedown (not click) so the input's blur doesn't dismiss the
              // popover before our handler runs.
              e.preventDefault();
              onSelect(i);
            }}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              cursor: "pointer",
              background: isActive ? "var(--bg-selected)" : "transparent",
              color: isCreate ? "var(--text-muted)" : "var(--text)",
              borderLeft: isCreate ? "2px dashed var(--border)" : "2px solid transparent",
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 3,
            }}
          >
            {isCreate ? (
              <span>{t("Create tag #{tag}").replace("{tag}", item.tag)}</span>
            ) : (
              <>
                <span style={{ color: "var(--text-dim)" }}>#</span>
                <span>{item.tag}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}