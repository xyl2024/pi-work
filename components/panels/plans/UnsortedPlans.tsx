"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { IconButton } from "@/components/ui/IconButton";
import type { UnsortedPlan } from "@/lib/shared/plans";
import { Chevron } from "./Chevron";
import { planProblemText } from "./problemText";
import { useCopyPath } from "./useCopyPath";

/**
 * The 待整理 area at the bottom of the plan list: files under `user-plans/`
 * that break the naming or frontmatter contract.
 *
 * They are listed with their path and every problem the parser found, so
 * nothing the user wrote silently disappears from the panel — and they get
 * **no** completion, note or re-schedule controls, because the only way to
 * write a plan back is the canonical serializer, which would drop whatever the
 * parser could not understand (ADR-0006). The server refuses such writes too
 * (`422`); this is the UI half of the same rule.
 *
 * Copying the path is the single action on offer: it hands the file to an
 * external editor, which is where the fix belongs.
 */
export function UnsortedPlans({ items }: { items: readonly UnsortedPlan[] }) {
  const { t } = useI18n();
  const copyPath = useCopyPath();
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 4, marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "4px 4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--warning)",
          fontSize: 11,
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        <Chevron open={open} />
        <span>{t("Unsorted")}</span>
        <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>{items.length}</span>
      </button>

      {open && (
        <>
          <p
            style={{
              margin: "0 4px 6px",
              fontSize: 10.5,
              lineHeight: 1.45,
              color: "var(--text-dim)",
            }}
          >
            {t(
              "These files do not follow the plan convention. Pi Work never rewrites them — fix them outside the panel and refresh.",
            )}
          </p>
          {items.map((item) => (
            <div
              key={item.path}
              style={{
                margin: "0 0 4px",
                padding: "5px 6px",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: 5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  title={item.absPath}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.path}
                </span>
                <span style={{ flexShrink: 0 }}>
                  <IconButton
                    label={t("Copy path")}
                    size="xs"
                    onClick={() => void copyPath(item.absPath)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="12" height="12" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </IconButton>
                </span>
              </div>
              {item.problems.map((problem, index) => (
                <div
                  key={`${problem.code}-${index}`}
                  style={{
                    marginTop: 2,
                    fontSize: 10.5,
                    lineHeight: 1.45,
                    color: "var(--text-muted)",
                    wordBreak: "break-word",
                  }}
                >
                  · {planProblemText(problem, t)}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
