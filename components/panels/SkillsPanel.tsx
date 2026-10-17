"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { currentSkillsPage } from "@/lib/shared/skills-pages";
import {
  ensureSkillsLoaded,
  escapeSkills,
  useSkillsStore,
} from "@/lib/client/skills-store";
import { SkillsRootPage } from "./skills/SkillsRootPage";
import { SkillDetailPage } from "./skills/SkillDetailPage";
import { SkillsBackButton } from "./skills/SkillsBackButton";

/**
 * The 技能 panel view body.
 *
 * The panel card only mounts the active tab's body, so this component owns no
 * page state: the list, the page stack and the toggle writes all live in
 * `lib/client/skills-store.ts`. Here it wires the per-cwd load, dispatches the
 * current page to a full-width view, and turns Escape into "up one level" —
 * falling back to the panel tab's close rule from the grid.
 *
 * The detail page fetches its own SKILL.md on mount (never cached in the
 * store); only the page stack survives a tab switch, so returning to the panel
 * lands back on the same skill and re-reads it from disk.
 */
export function SkillsPanel({
  cwd,
  onCloseTab,
}: {
  cwd: string | null;
  onCloseTab?: () => void;
}) {
  const { pages } = useSkillsStore();
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

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      {page.kind === "detail" ? (
        // Remounting on filePath keeps the fetch / expansion state scoped to
        // the skill actually on screen when one detail page replaces another.
        <SkillDetailPage key={page.filePath} filePath={page.filePath} />
      ) : page.kind === "add" ? (
        <AddPagePlaceholder />
      ) : (
        <SkillsRootPage />
      )}
    </div>
  );
}

/**
 * Temporary chrome for the add page: the search + streaming install body lands
 * in the next slice. The back control and the page stack are already the real
 * ones, so Back / Escape behave as they will once the body arrives.
 */
function AddPagePlaceholder() {
  const { t } = useI18n();
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 8px", flexShrink: 0 }}>
        <SkillsBackButton />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("Add Skill")}</span>
      </div>
      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 18px" }}>
        <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-dim)" }}>
          {t("Coming soon")}
        </div>
      </div>
    </div>
  );
}
