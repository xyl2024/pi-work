"use client";

import { useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { skillsPanel, useSkillsPanel } from "@/lib/client/skills-panel";
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
  useSkillsPanel();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    skillsPanel.open(cwd);
  }, [cwd]);

  const page = skillsPanel.currentPage();

  useEffect(() => {
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page]);

  usePanelEscapeGuard(containerRef, () => {
    if (skillsPanel.back().closePanel) onCloseTab?.();
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
