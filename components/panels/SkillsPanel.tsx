"use client";

import { useEffect, useRef } from "react";
import {
  clearSkillSelection,
  skillsPanel,
  useSkillsPanel,
} from "@/lib/client/skills-panel";
import { MainViewMasterDetail } from "./MainViewMasterDetail";
import { SkillsList } from "./skills/SkillsList";
import { SkillDetailPage } from "./skills/SkillDetailPage";
import { SkillSelectHint } from "./skills/SkillsEmptyStates";

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

  const { selectedFilePath } = view;

  const renderDetail = (onBack?: () => void) =>
    selectedFilePath === null ? (
      <SkillSelectHint />
    ) : (
      <SkillDetailPage key={selectedFilePath} filePath={selectedFilePath} onBack={onBack} />
    );

  return (
    <MainViewMasterDetail
      containerRef={containerRef}
      titleKey={null}
      onBack={null}
      list={<SkillsList />}
      detail={renderDetail}
      hasDetail={selectedFilePath !== null}
      onClearDetail={clearSkillSelection}
      onExit={onExit}
      visible={visible}
      focusKey={selectedFilePath ?? ""}
    />
  );
}
