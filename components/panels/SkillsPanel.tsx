"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import {
  clearSkillSelection,
  closeSkillsForm,
  skillsPanel,
  useSkillsPanel,
} from "@/lib/client/skills-panel";
import { MainViewMasterDetail } from "./MainViewMasterDetail";
import { SkillsList } from "./skills/SkillsList";
import { SkillDetailPage } from "./skills/SkillDetailPage";
import { SkillsAddPage } from "./skills/SkillsAddPage";
import { SkillSelectHint, SkillsInstallGuide } from "./skills/SkillsEmptyStates";

export function SkillsPanel({
  cwd,
  onExit,
  visible = true,
}: {
  cwd: string | null;
  onExit?: () => void;
  visible?: boolean;
}) {
  const { view } = useSkillsPanel();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    skillsPanel.open(cwd);
  }, [cwd]);

  const page = skillsPanel.currentPage();
  const { loaded, skills, selectedFilePath } = view;

  const backToBrowse = useCallback(() => {
    void closeSkillsForm();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page, selectedFilePath, visible, containerRef]);

  usePanelEscapeGuard(
    containerRef,
    () => {
      if (page.kind === "form") {
        void closeSkillsForm();
        return;
      }
      if (selectedFilePath !== null) {
        clearSkillSelection();
        return;
      }
      onExit?.();
    },
    visible,
  );

  const renderDetail = () =>
    loaded && skills.length === 0 ? (
      <SkillsInstallGuide />
    ) : selectedFilePath === null ? (
      <SkillSelectHint />
    ) : (
      <SkillDetailPage key={selectedFilePath} filePath={selectedFilePath} />
    );

  return (
    <MainViewMasterDetail
      containerRef={containerRef}
      titleKey={page.kind === "form" ? "Add Skill" : null}
      onBack={page.kind === "form" ? backToBrowse : null}
      full={page.kind === "form" ? <SkillsAddPage /> : null}
      list={<SkillsList />}
      detail={renderDetail}
      hasDetail={selectedFilePath !== null}
      onClearDetail={clearSkillSelection}
    />
  );
}
