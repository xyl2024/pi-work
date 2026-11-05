"use client";

import { useCallback, useEffect, useRef } from "react";
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

  const renderDetail = (onBack?: () => void) =>
    loaded && skills.length === 0 ? (
      <SkillsInstallGuide />
    ) : selectedFilePath === null ? (
      <SkillSelectHint />
    ) : (
      <SkillDetailPage key={selectedFilePath} filePath={selectedFilePath} onBack={onBack} />
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
      onExit={onExit}
      visible={visible}
      focusKey={`${page.kind}:${selectedFilePath ?? ""}`}
    />
  );
}
