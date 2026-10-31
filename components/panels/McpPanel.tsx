"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { PrimaryButton, SecondaryButton } from "@/components/settings/controls";
import {
  describeStdioCommands,
  describedRemovals,
  mcpDraftProblem,
  mcpPendingChanges,
  type McpDraftProblem,
} from "@/lib/shared/mcp-draft";
import { mcpOverrideExtraKeysError } from "@/lib/shared/mcp-panel";
import {
  mcpPanel,
  reloadMcp,
  saveMcpChanges,
  useMcpPanel,
} from "@/lib/client/mcp-store";
import { isMcpBucketVerifying, selectMcpBucket } from "@/lib/shared/mcp-drafts";
import { McpListPage } from "./mcp/McpListPage";
import { McpEntryPage } from "./mcp/McpEntryPage";

export function McpPanel({
  cwd,
  visible,
  onCloseTab,
  onNewSession,
}: {
  cwd: string | null;
  visible: boolean;
  onCloseTab?: () => void;
  onNewSession?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const state = useMcpPanel().view;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mcpPanel.setVisible(visible);
    mcpPanel.open(cwd);
  }, [cwd, visible]);

  const bucket = selectMcpBucket(state.buckets, state.currentCwd);
  const shownBucket = state.currentCwd === cwd ? bucket : null;
  const verifying = isMcpBucketVerifying(shownBucket);
  const page = mcpPanel.currentPage();

  useEffect(() => {
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page]);

  usePanelEscapeGuard(containerRef, () => {
    if (mcpPanel.back().closePanel) onCloseTab?.();
  });

  const problemText = useCallback(
    (value: McpDraftProblem | null): string | null => {
      if (!value) return null;
      switch (value.kind) {
        case "invalid-name":
          return t("mcp.problemInvalidName");
        case "duplicate-name":
          return t("mcp.problemDuplicateName", { name: value.name });
        case "not-an-object":
          return t("mcp.problemNotAnObject", { name: value.name });
        case "invalid-json":
          return t("mcp.problemInvalidJson", { name: value.name });
        case "missing-transport":
          return t("mcp.problemMissingTransport", { name: value.name });
        case "override-extra-keys":
          return mcpOverrideExtraKeysError(value.name);
      }
    },
    [t],
  );

  const problem = bucket ? mcpDraftProblem(bucket.draft) : null;
  const dirty = bucket?.dirty ?? false;
  const entry = page.kind === "entry" ? bucket?.draft.entries.find((item) => item.uid === page.uid) ?? null : null;
  const loadError = state.loadErrorCwd === cwd ? state.loadError : null;

  const save = useCallback(async () => {
    if (!bucket || problem) return;
    const changes = mcpPendingChanges(bucket.draft, bucket.data);
    if (changes.length === 0) return;

    const gates: string[] = [];
    const removals = describedRemovals(changes);
    if (removals.length > 0) gates.push(t("mcp.confirmRemove", { names: removals.join(", ") }));
    const commands = describeStdioCommands(changes);
    if (commands.length > 0) gates.push(t("mcp.confirmSpawn", { commands: commands.join("\n") }));
    if (gates.length > 0) {
      const ok = await confirm({
        title: t("mcp.confirmSaveTitle"),
        description: gates.join("\n\n"),
        confirmLabel: t("mcp.save"),
        cancelLabel: t("mcp.cancel"),
        destructive: false,
      });
      if (!ok) return;
    }

    const result = await saveMcpChanges();
    if (result.ok) toast.show({ kind: "success", message: t("mcp.saved") });
    else if (result.error) toast.show({ kind: "error", message: t("mcp.saveFailed", { error: result.error }) });
  }, [bucket, confirm, problem, t, toast]);

  const footerStatus = useMemo(() => {
    if (state.saveError) return { tone: "error" as const, text: t("mcp.saveFailed", { error: state.saveError }) };
    const text = problemText(problem);
    if (text) return { tone: "error" as const, text };
    if (state.savedOnce) {
      return { tone: "muted" as const, text: dirty ? null : t("mcp.savedHint") };
    }
    return { tone: "muted" as const, text: null };
  }, [dirty, problem, problemText, state.saveError, state.savedOnce, t]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {verifying && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 12,
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: "var(--text-dim)",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "2px 8px",
              pointerEvents: "none",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
            {t("mcp.verifying")}
          </div>
        )}
        {loadError ? (
          <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--error)", fontSize: 12 }}>
            {t("mcp.loadFailed", { error: loadError })}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => reloadMcp()}
                style={{ padding: "4px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", fontFamily: "inherit" }}
              >
                {t("Retry")}
              </button>
            </div>
          </div>
        ) : cwd === null ? (
          <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>{t("mcp.noCwd")}</div>
        ) : !bucket || state.currentCwd !== cwd ? (
          <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>{t("Loading...")}</div>
        ) : entry ? (
          <McpEntryPage bucket={bucket} entry={entry} />
        ) : (
          <McpListPage bucket={bucket} />
        )}
      </div>

      {bucket && state.currentCwd === cwd && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderTop: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0 }}>
          <span
            title={footerStatus.tone === "error" ? footerStatus.text : undefined}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 11,
              color: footerStatus.tone === "error" ? "var(--error)" : "var(--text-dim)",
            }}
          >
            {footerStatus.text}
          </span>
          {state.savedOnce && onNewSession && (
            <SecondaryButton onClick={onNewSession}>{t("mcp.newSession")}</SecondaryButton>
          )}
          <PrimaryButton
            onClick={() => void save()}
            disabled={state.saving || !dirty || problem !== null}
            style={{ minWidth: 92 }}
          >
            {state.saving ? t("mcp.saving") : t("mcp.save")}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
