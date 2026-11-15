"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SaveButton, UnsavedHint } from "@/components/settings/staged-save";
import { TextArea } from "@/components/settings/controls";
import { requestMainViewLeave } from "@/lib/client/main-view-leave";
import {
  deleteMemoryCategory,
  isMemoryContentDirty,
  saveMemoryChanges,
  setMemoryContent,
  useMemoryPanel,
} from "@/lib/client/memory-panel";

export function MemoryDetailPage({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { view } = useMemoryPanel();
  const { selectedFile, detailLoading, detailError, content, saving, saveError, deleting, deleteError } = view;
  const dirty = isMemoryContentDirty(view);
  const [saved, setSaved] = useState(false);

  if (selectedFile === null) return null;

  const isIndex = selectedFile === "INDEX.md";

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete "{file}"', { file: selectedFile }),
      description: t("Its registration line in the memory index will also be removed."),
      destructive: true,
    });
    if (ok) void deleteMemoryCategory(selectedFile);
  };

  const save = () => {
    void saveMemoryChanges().then(() => {
      if (!view.saveError) setSaved(true);
    });
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 12px 8px",
          flexShrink: 0,
        }}
      >
        {onBack && (
          <button
            type="button"
            onClick={() => void handleBack(onBack)}
            aria-label={t("Back")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "none", border: "none", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
          >
            <ArrowLeftIcon width={14} height={14} aria-hidden="true" />
          </button>
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
          }}
        >
          {selectedFile}
        </span>
        {dirty && <UnsavedHint show />}
        <SaveButton canSave={dirty} saving={saving} saved={saved && !dirty} onClick={save} />
        {!isIndex && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={deleting}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 24,
              padding: "0 8px",
              fontSize: 12,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {t("Delete")}
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 12px 12px" }}>
        {detailLoading ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("Loading...")}</div>
        ) : detailError ? (
          <div style={{ fontSize: 12, color: "var(--error)", wordBreak: "break-word" }}>{detailError}</div>
        ) : (
          <TextArea
            value={content}
            onChange={setMemoryContent}
            mono
            style={{ flex: 1, minHeight: 0, width: "100%", resize: "none" }}
          />
        )}
        {(saveError || deleteError) && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--error)", wordBreak: "break-word", flexShrink: 0 }}>
            {saveError ?? deleteError}
          </div>
        )}
      </div>
    </div>
  );
}

async function handleBack(onBack: () => void): Promise<void> {
  if (await requestMainViewLeave({ view: "memory", intent: "select_task" })) onBack();
}
