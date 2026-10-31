"use client";

import { useEffect, useState, type ReactNode, type Ref } from "react";

interface Props {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
  durationMs?: number;
  grow?: number;
  contentHeight?: number;
  scrollRef?: Ref<HTMLDivElement>;
}

export function SidebarSection({
  title,
  open,
  onToggle,
  actions,
  children,
  durationMs = 180,
  grow = 1,
  contentHeight,
  scrollRef,
}: Props) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), durationMs + 40);
    return () => window.clearTimeout(timer);
  }, [open, durationMs]);

  const ease = "cubic-bezier(0.32, 0.72, 0, 1)";
  const isFixedHeight = grow === 0 && contentHeight === undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: open ? grow : 0,
        flexShrink: open && (grow > 0 || contentHeight !== undefined) ? 1 : 0,
        flexBasis: "auto",
        minHeight: 0,
        overflow: "hidden",
        transition: `flex-grow ${durationMs}ms ${ease}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={onToggle}
          aria-expanded={open}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            padding: "6px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            textAlign: "left",
          }}
        >
          <svg
            width="9" height="9" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{
              flexShrink: 0,
              transform: open ? "rotate(90deg)" : "none",
              transition: `transform ${durationMs}ms ${ease}`,
            }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
          {title}
        </button>
        {actions && (
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {mounted &&
        (isFixedHeight ? (
          <div
            style={{
              display: "grid",
              gridTemplateRows: open ? "1fr" : "0fr",
              flex: "0 0 auto",
              minHeight: 0,
              transition: `grid-template-rows ${durationMs}ms ${ease}`,
            }}
          >
            <div
              style={{
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <div
                ref={scrollRef}
                data-scroll-side
                style={{
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                {children}
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              flex: contentHeight === undefined ? "1 1 0" : "1 1 auto",
              height: contentHeight === undefined ? undefined : open ? contentHeight : 0,
              minHeight: 0,
              overflow: "hidden",
              transition: `height ${durationMs}ms ${ease}`,
            }}
          >
            <div
              ref={scrollRef}
              data-scroll-side
              style={{
                height: "100%",
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {children}
            </div>
          </div>
        ))}
    </div>
  );
}
