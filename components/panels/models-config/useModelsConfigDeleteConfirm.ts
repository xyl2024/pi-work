"use client";

import { useCallback } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useI18n } from "@/hooks/useI18n";
import {
  cancelModelsConfigDelete,
  confirmModelsConfigDelete,
  modelsConfigPanel,
  selectModelsConfigDeleteConfirm,
} from "@/lib/client/models-config-panel";

export function useModelsConfigDeleteConfirm(): (request: () => void) => Promise<void> {
  const { t } = useI18n();
  const confirm = useConfirm();
  return useCallback(
    async (request: () => void) => {
      request();
      const prompt = selectModelsConfigDeleteConfirm(modelsConfigPanel.get());
      if (!prompt) {
        cancelModelsConfigDelete();
        return;
      }
      const ok = await confirm({
        title: t(prompt.titleKey),
        description: t(prompt.descriptionKey, prompt.params),
        destructive: true,
      });
      if (ok) confirmModelsConfigDelete();
      else cancelModelsConfigDelete();
    },
    [confirm, t],
  );
}
