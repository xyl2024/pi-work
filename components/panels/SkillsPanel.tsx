"use client";

import { useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { currentSkillsPage } from "@/lib/shared/skills-pages";
import {
  ensureSkillsLoaded,
  escapeSkills,
  useSkillsStore,
} from "@/lib/client/skills-store";
import { SkillsRootPage } from "./skills/SkillsRootPage";
import { SkillDetailPage } from "./skills/SkillDetailPage";
import { SkillsAddPage } from "./skills/SkillsAddPage";

export function SkillsPanel({
  cwd,
  onCloseTab,
}: {
  cwd: string | null;
  onCloseTab?: () => void;
}) {
  const { pages } = useSkillsStore();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureSkillsLoaded(cwd);
  }, [cwd]);

  const page = currentSkillsPage(pages);

  useEffect(() => {
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
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
        <SkillDetailPage key={page.filePath} filePath={page.filePath} />
      ) : page.kind === "add" ? (
        <SkillsAddPage />
      ) : (
        <SkillsRootPage />
      )}
    </div>
  );
}
