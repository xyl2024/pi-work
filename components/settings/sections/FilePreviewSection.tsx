"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/Toast";
import { FileViewerLimitRow } from "../rows";
import { FILE_VIEWER_UI } from "../constants";
import {
  FILE_VIEWER_LIMITS,
  type FileViewerKind,
  type FileViewerMaxSizeMb,
} from "@/lib/file-viewer-limits";
import type { PiWorkConfig } from "@/lib/config";

/**
 * Section 8: File preview limits.
 *
 * Per-kind MB caps using the shared `FileViewerLimitRow` (each row
 * owns its own draft + range validation; the section just receives
 * the parsed `next` value via `onCommit`). Validation is also
 * enforced here as defense-in-depth before the immediate-apply PUT,
 * so a regression in the row's blur handler can't write an
 * out-of-range value.
 *
 * Already-open file tabs are not force-refetched — the new limit
 * applies on the next read (Q9 decision from the original module).
 */
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
    <div data-settings-section="settings-section-file-preview" style={{ marginBottom: 24, marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("File preview limits")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
        {t("Maximum file size the preview pane will load. Audio and video are streamed with no size limit.")}
      </p>
      {FILE_VIEWER_UI.map(({ kind, labelKey }) => {
        const { min, max } = FILE_VIEWER_LIMITS[kind];
        return (
          <FileViewerLimitRow
            key={kind}
            label={t(labelKey)}
            min={min}
            max={max}
            value={config.file_viewer.max_size_mb[kind]}
            onCommit={(next) => void handleChange(kind, next)}
          />
        );
      })}
    </div>
  );
}