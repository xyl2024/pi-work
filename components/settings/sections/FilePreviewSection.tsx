"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { NumericField } from "@/components/ui/NumericField";
import { SettingsGroup, SettingsRow } from "../rows";
import { FILE_VIEWER_UI } from "../constants";
import {
  FILE_VIEWER_LIMITS,
  type FileViewerKind,
  type FileViewerMaxSizeMb,
} from "@/lib/shared/file-viewer-limits";
import type { PiWorkConfig } from "@/lib/shared/config-types";

export function FilePreviewSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const toast = useToast();

  const handleChange = useCallback(
    async (kind: FileViewerKind, next: number) => {
      const { min, max } = FILE_VIEWER_LIMITS[kind];
      if (!Number.isInteger(next) || next < min || next > max) {
        toast.show({
          kind: "error",
          message: t("Must be between {min} and {max}", { min, max }),
        });
        return;
      }
      await apply((prev) => {
        const nextMaxSizeMb: FileViewerMaxSizeMb = {
          ...prev.file_viewer.max_size_mb,
          [kind]: next,
        };
        return { ...prev, file_viewer: { max_size_mb: nextMaxSizeMb } };
      });
    },
    [apply, t, toast],
  );

  return (
    <SettingsGroup>
      {FILE_VIEWER_UI.map(({ kind, labelKey }) => {
        const { min, max } = FILE_VIEWER_LIMITS[kind];
        return (
          <SettingsRow
            key={kind}
            title={t(labelKey)}
            description={t("Range: {min}–{max} MB", { min, max })}
          >
            <NumericField
              value={config.file_viewer.max_size_mb[kind]}
              onCommit={(next) => { if (next !== null) void handleChange(kind, next); }}
              min={min}
              max={max}
              unit="MB"
              ariaLabel={t(labelKey)}
            />
          </SettingsRow>
        );
      })}
    </SettingsGroup>
  );
}
