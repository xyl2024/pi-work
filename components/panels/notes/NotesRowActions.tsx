"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";

/** A tiny inline popover that lists all folders a note can be moved into.
 *  Rendered inside the row's relative wrapper so it anchors just below the
 *  row that triggered it. */
export function NoteFolderPicker({
  folders,
  onPick,
  onClose,
}: {
  folders: { path: string; name: string }[];
  onPick: (destDir: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="notes-fade-in"
      style={{
        position: "absolute",
        top: "calc(100% + 2px)",
        right: 4,
        zIndex: 50,
        minWidth: 180,
        maxHeight: 240,
        overflowY: "auto",
        padding: 5,
        background: "var(--bg-panel)",
        border: "1px solid var(--panel-border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
      }}
    >
      <div style={{ padding: "2px 6px 6px", color: "var(--text-dim)", fontSize: 11, fontWeight: 500 }}>
        {t("Move to")}
      </div>
      {folders.length === 0 ? (
        <div style={{ padding: "6px 8px", color: "var(--text-dim)", fontSize: 12 }}>—</div>
      ) : (
        folders.map((f) => {
          const depth = f.path ? f.path.split("/").length - 1 : 0;
          return (
            <button
              key={f.path}
              type="button"
              onClick={() => onPick(f.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "5px 6px",
                paddingLeft: 6 + depth * 12,
                fontSize: 12,
                color: "var(--text)",
                background: "transparent",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ color: "var(--text-dim)", display: "inline-flex", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            </button>
          );
        })
      )}
    </div>
  );
}
