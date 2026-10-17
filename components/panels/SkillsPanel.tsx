"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { currentSkillsPage } from "@/lib/shared/skills-pages";
import {
  ensureSkillsLoaded,
  escapeSkills,
  skillsBack,
  useSkillsStore,
} from "@/lib/client/skills-store";
import { SkillsRootPage } from "./skills/SkillsRootPage";

/**
 * The 技能 panel view body.
 *
 * The panel card only mounts the active tab's body, so this component owns no
 * page state: the list, the page stack and the toggle writes all live in
 * `lib/client/skills-store.ts`. Here it wires the per-cwd load, dispatches the
 * current page to a full-width view, and turns Escape into "up one level" —
 * falling back to the panel tab's close rule from the grid.
 */
export function SkillsPanel({
  cwd,
  onCloseTab,
}: {
  cwd: string | null;
  onCloseTab?: () => void;
}) {
  const { t } = useI18n();
  const { pages, skills } = useSkillsStore();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // The list follows the selected session's working directory (the shell
  // passes the same fallback - new-session cwd - the modal used).
  useEffect(() => {
    ensureSkillsLoaded(cwd);
  }, [cwd]);

  const page = currentSkillsPage(pages);

  // Focus is kept inside the panel while it is the active surface, so a
  // palette / dialog that has taken focus keeps its own Escape.
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, [page]);

  usePanelEscapeGuard(containerRef, () => {
    if (escapeSkills().closePanel) onCloseTab?.();
  });

  const detailName =
    page.kind === "detail"
      ? skills.find((skill) => skill.filePath === page.filePath)?.name ?? page.filePath
      : "";

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      {page.kind === "root" ? (
        <SkillsRootPage />
      ) : (
        <SubPagePlaceholder
          label={page.kind === "detail" ? detailName : t("Add Skill")}
          body={t("Coming soon")}
          onBack={skillsBack}
        />
      )}
    </div>
  );
}

/**
 * Temporary chrome for the two deeper levels: the real SKILL.md / attached-file
 * page and the search+install page land in the next slices. The back control
 * and the page stack are already the real ones, so Escape / Back behave as
 * they will once the bodies arrive.
 */
function SubPagePlaceholder({
  label,
  body,
  onBack,
}: {
  label: string;
  body: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 12px 8px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t("Skills")}
        </button>
        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>/</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={label}
        >
          {label}
        </span>
      </div>
      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 18px" }}>
        <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-dim)" }}>{body}</div>
      </div>
    </div>
  );
}
