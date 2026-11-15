"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { memoryPanel, selectMemoryFile, useMemoryPanel } from "@/lib/client/memory-panel";
import { MainViewMasterDetail } from "../MainViewMasterDetail";
import { MemoryList } from "./MemoryList";
import { MemoryDetailPage } from "./MemoryDetailPage";

export function MemoryPanel({
  onExit,
  onOpenSettings,
  visible = true,
}: {
  onExit?: () => void;
  onOpenSettings: () => void;
  visible?: boolean;
}) {
  const { t } = useI18n();
  const { view } = useMemoryPanel();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    memoryPanel.open();
  }, []);

  const { disabled, selectedFile } = view;

  if (disabled) {
    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, outline: "none" }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("Memory management")}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("Memory is disabled")}</span>
        <span style={{ fontSize: 12, color: "var(--text-dim)", maxWidth: 320, textAlign: "center" }}>
          {t("Turn memory on in settings to see and edit memory files here.")}
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          style={{
            padding: "5px 14px",
            fontSize: 12,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          {t("Open in settings")}
        </button>
      </div>
    );
  }

  const renderDetail = (onBack?: () => void) =>
    selectedFile === null ? null : <MemoryDetailPage key={selectedFile} onBack={onBack} />;

  return (
    <MainViewMasterDetail
      containerRef={containerRef}
      titleKey={null}
      onBack={null}
      list={<MemoryList />}
      detail={renderDetail}
      hasDetail={selectedFile !== null}
      onClearDetail={() => selectMemoryFile(null)}
      onExit={onExit}
      visible={visible}
      focusKey={selectedFile ?? ""}
    />
  );
}
