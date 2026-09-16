"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/client/clipboard";

/**
 * Copy an absolute file path and report the outcome — the one action a plan row
 * and a 待整理 row both offer, worded once so the two cannot drift.
 *
 * The clipboard write can genuinely fail (insecure context, blurred window), so
 * both outcomes are surfaced rather than swallowed.
 */
export function useCopyPath(): (absPath: string) => Promise<void> {
  const { t } = useI18n();
  const toast = useToast();
  return useCallback(
    async (absPath: string) => {
      try {
        await copyText(absPath);
        toast.show({ kind: "success", message: t("Path copied"), description: absPath });
      } catch {
        toast.show({ kind: "error", message: t("Copy path failed"), description: absPath });
      }
    },
    [t, toast],
  );
}
