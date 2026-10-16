"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../../ui/Toast";
import { copyText } from "@/lib/client/clipboard";
import { modelsConfigProblemText } from "@/lib/client/models-config-problem-text";
import type { ModelEntry, RuntimeModelInfo } from "./types";
import { SectionTitle } from "./form-fields";
import { cloneModelFromCatalog, parseModelEntryJson } from "@/lib/shared/models-config-draft";
import { ModelFields } from "./ModelFields";
import { ModelRawSection } from "./ModelRawSection";
import { ModelCatalogPickerBody } from "./runtime";
import { ModalShell } from "./ModalShell";

export function ModelDetail({ model, onChange, onDelete }: { model: ModelEntry; onChange: (m: ModelEntry) => void; onDelete: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [fillPickerOpen, setFillPickerOpen] = useState(false);
  const [rawEditMode, setRawEditMode] = useState(false);
  const [rawDraft, setRawDraft] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const rawJson = useMemo(() => JSON.stringify(model, null, 2), [model]);
  const enterRawEditMode = () => {
    setRawDraft(rawJson);
    setRawError(null);
    setRawEditMode(true);
  };
  const applyRawDraft = () => {
    const parsed = parseModelEntryJson(rawDraft);
    if (!parsed.ok) {
      setRawError(modelsConfigProblemText(parsed, t));
      return;
    }
    onChange(parsed.model);
    setRawEditMode(false);
    setRawError(null);
    toast.show({ kind: "success", message: t("Raw metadata applied") });
  };
  const copyRawJson = async () => {
    try {
      await copyText(rawJson);
      toast.show({ kind: "success", message: t("Copied") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Network error") });
    }
  };
  const fillFromCatalog = (source: RuntimeModelInfo) => {
    onChange(cloneModelFromCatalog(source));
    setFillPickerOpen(false);
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <SectionTitle>{t("Model")}</SectionTitle>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setFillPickerOpen(true)}
              style={{ padding: "3px 8px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11 }}
            >
              {t("Fill from model catalog")}
            </button>
            <button
              onClick={onDelete}
              style={{ padding: "3px 8px", background: "none", border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)", borderRadius: 4, color: "var(--error)", cursor: "pointer", fontSize: 11 }}
            >
              {t("Delete")}
            </button>
          </div>
        </div>

        <ModelFields model={model} onChange={onChange} />

        <ModelRawSection
          summaryJson={rawJson}
          editing={rawEditMode}
          draft={rawDraft}
          error={rawError}
          onEnterEdit={enterRawEditMode}
          onDraftChange={(text) => { setRawDraft(text); setRawError(null); }}
          onCancel={() => { setRawEditMode(false); setRawError(null); }}
          onApply={applyRawDraft}
          onCopy={() => { void copyRawJson(); }}
        />
      </div>
      {fillPickerOpen && (
        <ModalShell width={760} height="min(76vh, calc(100vh - 32px))" onClose={() => setFillPickerOpen(false)}>
          <ModelCatalogPickerBody onSelect={fillFromCatalog} onClose={() => setFillPickerOpen(false)} />
        </ModalShell>
      )}
    </>
  );
}
