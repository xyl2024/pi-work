"use client";

import { useMemo, useState, type RefObject } from "react";
import { Tooltip } from "../../ui/Tooltip";
import { ContextUsageBar } from "../ContextUsageBar";
import { CwdPicker } from "../../sessions/CwdPicker";
import { CwdProjectIcon } from "../../files/CwdProjectIcon";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "../../ui/ProviderIcon";
import { ModelPickerModal } from "../ModelPickerModal";
import { ToolsPickerModal } from "../ToolsPickerModal";
import {
  ThinkingPicker,
  THINKING_LEVEL_COLOR,
  ThinkingIcon,
  availableThinkingLevelsOf,
  nextThinkingLevel,
  type ThinkingLevel,
} from "../ThinkingPicker";
import { MoreMenu, type CollapsedMenuEntry } from "../MoreMenu";
import { useToolbarLayout } from "./hooks/useToolbarLayout";
import { ICONS } from "../../ui/icons";
import { FULL_ACCESS_RED } from "../../ui/permission-mode-colors";
import { NewSessionNotifyPicker } from "../chat-window/NewSessionNotifyPicker";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import type { PermissionMode } from "@/lib/shared/permission-mode";
import type { ContextUsage, SessionStats } from "@/hooks/sessionUiStore";
import type { ContextComposition } from "@/lib/shared/context-composition";

type ThinkingLevelOption = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface BottomToolbarProps {
  t: (key: string, params?: Record<string, string | number>) => string;
  isStreaming: boolean;

  onSlashAction?: (action: string) => void;
  hasAttachedImages: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  model?: { provider: string; modelId: string } | null;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; reasoning?: boolean; input?: string[]; contextWindow?: number; maxTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }[];
  onModelChange?: (provider: string, modelId: string) => void;
  cwd?: string | null;
  onCwdChange?: (cwd: string) => void;

  contextUsage: ContextUsage | null;
  contextComposition: ContextComposition | null;
  sessionStats: SessionStats;

  permissionMode?: PermissionMode;
  onPermissionModeToggle?: () => void;

  thinkingLevel?: ThinkingLevelOption;
  onThinkingLevelChange?: (level: ThinkingLevelOption) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;

  toolSelection: ToolSelection;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  toolDropdownRef: RefObject<HTMLDivElement | null>;
  toolDropdownOpen: boolean;
  setToolDropdownOpen: (open: boolean) => void;
  onToolSelectionChange?: (selection: ToolSelection) => void;
  onEnsureAvailableTools?: () => Promise<void>;
  customExpanded: boolean;
  toggleCustomExpanded: () => void;

  showNotifyPicker?: boolean;
  notifyChannelId?: string | null;
  onNotifyChannelChange?: (channelId: string | null) => void;
}

export function BottomToolbar(props: BottomToolbarProps) {
  const {
    t,
    isStreaming,
    onSlashAction,
    hasAttachedImages,
    fileInputRef,
    model, modelNames, modelIcons, modelIconPreferences, modelList, onModelChange,
    cwd, onCwdChange,
    contextUsage, sessionStats, contextComposition,
    permissionMode = "confirm",
    onPermissionModeToggle,
    thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
    toolSelection, availableTools, toolsLoading, toolsError,
    toolDropdownRef,
    onToolSelectionChange, onEnsureAvailableTools,
    customExpanded, toggleCustomExpanded,
    showNotifyPicker = false, notifyChannelId = null, onNotifyChannelChange,
  } = props;

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [toolsPickerOpen, setToolsPickerOpen] = useState(false);

  const modelOptionsEmpty = (modelList?.length ?? 0) === 0 && Object.keys(modelNames ?? {}).length === 0;
  const currentModelName = model
    ? (modelList?.find((m) => m.id === model.modelId && m.provider === model.provider)?.name
       ?? modelNames?.[model.modelId]
       ?? model.modelId)
    : null;

  const currentModelMeta = model
    ? modelList?.find((m) => m.id === model.modelId && m.provider === model.provider)
    : undefined;
  const formatTokens = (n: number): string =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(0)}k`
        : String(n);
  const formatCost = (n: number): string => `$${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}`;

  const modelMetaTooltip = !currentModelMeta ? currentModelName : (
    <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 12px", whiteSpace: "nowrap" }}>
      <span style={{ gridColumn: "1 / -1", fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis" }}>
        {currentModelMeta.name}
      </span>
      <span style={{ color: "var(--text-dim)" }}>{t("Context window")}</span>
      <span>{currentModelMeta.contextWindow ? `${formatTokens(currentModelMeta.contextWindow)} tokens` : "—"}</span>
      <span style={{ color: "var(--text-dim)" }}>{t("Max output")}</span>
      <span>{currentModelMeta.maxTokens ? `${formatTokens(currentModelMeta.maxTokens)} tokens` : "—"}</span>
      <span style={{ color: "var(--text-dim)" }}>{t("Reasoning / thinking")}</span>
      <span>{currentModelMeta.reasoning ? t("Yes") : t("No")}</span>
      <span style={{ color: "var(--text-dim)" }}>{t("Image input")}</span>
      <span>{currentModelMeta.input?.includes("image") ? t("Yes") : t("No")}</span>
      {currentModelMeta.cost?.input != null && (
        <>
          <span style={{ color: "var(--text-dim)" }}>{t("Cost (per million tokens)")}</span>
          <span>
            {t("Input")} {formatCost(currentModelMeta.cost.input)} · {t("Output")} {formatCost(currentModelMeta.cost.output ?? 0)}
          </span>
        </>
      )}
      <span style={{ gridColumn: "1 / -1", marginTop: 2, fontFamily: "var(--font-mono)", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis" }}>
        {currentModelMeta.provider} · {currentModelMeta.id}
      </span>
    </div>
  );

  const currentThinkingLevel: ThinkingLevel = (thinkingLevel ?? "off") as ThinkingLevel;
  const currentThinkingMapped = thinkingLevelMap
    ? thinkingLevelMap[currentThinkingLevel]
    : undefined;
  const currentThinkingDisplay = currentThinkingMapped != null && currentThinkingMapped !== currentThinkingLevel
    ? currentThinkingMapped
    : currentThinkingLevel;

  const handleToolSelectionChangeLocal = onToolSelectionChange ?? (() => {});

  const permissionFullAccess = permissionMode === "full_access";

  const { containerRef, layout, width } = useToolbarLayout();

  const showModelName = layout.modelLabelWidth !== null;
  const showCwdName = layout.cwdLabelVisible;
  const compactContext = layout.contextBarCompact;
  const showToolsLabel = layout.toolsLabelVisible;
  const showThinkingLabel = layout.thinkingLabelVisible;
  const thinkingCollapsed = layout.collapsed.includes("thinking");
  const toolsCollapsed = layout.collapsed.includes("tools");
  const cwdCollapsed = layout.collapsed.includes("cwd");

  const modelTooltipMaxWidth = width === null
    ? 420
    : Math.max(0, Math.min(420, width - 24));

  const [collapsedCwdOpen, setCollapsedCwdOpen] = useState(false);

  const availableLevels = useMemo(
    () => availableThinkingLevelsOf(availableThinkingLevels),
    [availableThinkingLevels],
  );

  const collapsedEntries = useMemo<CollapsedMenuEntry[]>(() => {
    const entries: CollapsedMenuEntry[] = [];
    if (thinkingCollapsed && onThinkingLevelChange) {
      entries.push({
        key: "thinking",
        label: `${t("Thinking level")} · ${currentThinkingDisplay}`,
        icon: (
          <span style={{ display: "flex", color: THINKING_LEVEL_COLOR[currentThinkingLevel] }}>
            <ThinkingIcon size={14} />
          </span>
        ),
        onClick: () => {
          const next = nextThinkingLevel(currentThinkingLevel, availableLevels);
          if (next) onThinkingLevelChange(next);
        },
      });
    }
    if (toolsCollapsed && !isStreaming) {
      entries.push({
        key: "tools",
        label: t("Tools"),
        icon: <ToolsIcon size={14} />,
        onClick: () => setToolsPickerOpen(true),
      });
    }
    if (cwdCollapsed && onCwdChange) {
      entries.push({
        key: "cwd",
        label: t("Change project"),
        icon: <CwdProjectIcon cwd={cwd ?? null} size={14} />,
        onClick: () => setCollapsedCwdOpen(true),
      });
    }
    return entries;
  }, [
    thinkingCollapsed, toolsCollapsed, cwdCollapsed,
    onThinkingLevelChange, onCwdChange, isStreaming,
    t, currentThinkingDisplay, currentThinkingLevel, availableLevels, cwd,
  ]);

  return (
    <div
      ref={containerRef}
      style={{ marginTop: 8, display: "flex", alignItems: "center", gap: layout.buttonGap }}
    >
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 2 }}>
        <Tooltip content={t("New session")}>
          <button
            type="button"
            onClick={() => onSlashAction?.("new")}
            aria-label={t("New session")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, padding: 0, flexShrink: 0,
              background: "none",
              border: "none",
              borderRadius: "50%",
              color: "var(--text-muted)",
              cursor: "pointer",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </Tooltip>
        {!isStreaming && (
          <Tooltip content={t("Upload image")}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("Upload image")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, padding: 0, flexShrink: 0,
                background: "none",
                border: "none",
                borderRadius: 9,
                color: hasAttachedImages ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = hasAttachedImages ? "var(--accent-hover)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = hasAttachedImages ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          </Tooltip>
        )}
        {!modelOptionsEmpty && (
          <Tooltip
            content={modelMetaTooltip}
            interactive
            maxWidth={modelTooltipMaxWidth}
          >
          <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setModelPickerOpen(true)}
            disabled={isStreaming}
            aria-label={showModelName ? t("Switch model") : `${t("Switch model")}: ${currentModelName}`}
            style={{
              display: "flex", alignItems: "center", justifyContent: showModelName ? "flex-start" : "center",
              gap: 6,
              padding: showModelName ? "8px 12px" : 0,
              height: 32,
              width: showModelName ? undefined : 32,
              maxWidth: layout.modelLabelWidth ?? 32,
              flexShrink: 0, overflow: "hidden",
              background: "none",
              border: "none",
              borderRadius: 9,
              color: "var(--text-muted)",
              cursor: isStreaming ? "not-allowed" : "pointer",
              fontSize: 12,
              opacity: isStreaming ? 0.5 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              if (isStreaming) return;
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <ProviderIcon
              id={resolveProviderIcon(model?.provider, model?.modelId, modelIcons, modelIconPreferences) ?? ""}
              size={12}
              fallback={<ProviderGearIcon size={11} />}
            />
            {showModelName && (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{currentModelName}</span>
            )}
          </button>
          </span>
          </Tooltip>
        )}
        <ModelPickerModal
          open={modelPickerOpen}
          model={model ?? null}
          modelNames={modelNames}
          modelIcons={modelIcons}
          modelIconPreferences={modelIconPreferences}
          modelList={modelList}
          disabled={isStreaming}
          onModelChange={onModelChange}
          onClose={() => setModelPickerOpen(false)}
        />

        {onCwdChange && (
          <CwdPicker
            cwd={cwd ?? null}
            onCwdChange={onCwdChange}
            disabled={isStreaming}
            dropdownDirection="up"
            iconOnly={!showCwdName}
            hideTrigger={cwdCollapsed}
            openSignal={cwdCollapsed && collapsedCwdOpen}
            onOpenSignalHandled={() => setCollapsedCwdOpen(false)}
          />
        )}
      </div>

      <div style={{ flex: 1 }} />

      {contextUsage && (
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 4 }}>
          <ContextUsageBar contextUsage={contextUsage} sessionStats={sessionStats} contextComposition={contextComposition} compact={compactContext} />
        </div>
      )}

      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 2, marginLeft: "auto" }}>
        {isStreaming && (
          <span
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              height: 32, padding: showThinkingLabel ? "0 10px" : 0,
              width: showThinkingLabel ? undefined : 32, flexShrink: 0,
              fontSize: 12, color: THINKING_LEVEL_COLOR[currentThinkingLevel],
              background: "none", border: "none", borderRadius: 9,
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
            }}
            aria-label={`${t("Thinking level")}: ${currentThinkingDisplay}`}
          >
            <ThinkingIcon />
            {showThinkingLabel && currentThinkingDisplay}
          </span>
        )}
        {!isStreaming && onThinkingLevelChange && !thinkingCollapsed && (
          <ThinkingPicker
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={onThinkingLevelChange}
            availableThinkingLevels={availableThinkingLevels}
            thinkingLevelMap={thinkingLevelMap}
            labelVisible={showThinkingLabel}
          />
        )}
        {!isStreaming && !toolsCollapsed && (
          <div ref={toolDropdownRef}>
            <button
              type="button"
              onClick={() => setToolsPickerOpen(true)}
              aria-label={t("Tools")}
              style={{
                display: "flex", alignItems: "center", justifyContent: showToolsLabel ? "flex-start" : "center", gap: 6,
                padding: showToolsLabel ? "0 10px" : 0, height: 32,
                width: showToolsLabel ? undefined : 32, flexShrink: 0,
                overflow: "hidden",
                background: toolsPickerOpen ? "var(--bg-hover)" : "none",
                border: "none", borderRadius: 9,
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (toolsPickerOpen) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = toolsPickerOpen ? "var(--bg-hover)" : "none";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <ToolsIcon />
              {showToolsLabel && (
                <span style={{ whiteSpace: "nowrap" }}>
                  {t("Tools")}
                </span>
              )}
            </button>
          </div>
        )}
        {!isStreaming && (
          <ToolsPickerModal
            open={toolsPickerOpen}
            toolSelection={toolSelection}
            availableTools={availableTools}
            toolsLoading={toolsLoading}
            toolsError={toolsError}
            customExpanded={customExpanded}
            onToggleTool={handleToolSelectionChangeLocal}
            onRetryEnsureTools={onEnsureAvailableTools}
            onToggleCustomExpanded={toggleCustomExpanded}
            onClose={() => setToolsPickerOpen(false)}
          />
        )}
        {onPermissionModeToggle && (
          <Tooltip
            content={
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 240 }}>
                <span style={{ fontWeight: 600 }}>
                  {permissionFullAccess ? t("Allow full access") : t("Confirm dangerous commands")}
                </span>
                <span>
                  {permissionFullAccess
                    ? t("Dangerous commands in this session run without asking. Self-protection still blocks commands that would kill the Pi Work server.")
                    : t("Dangerous commands in this session ask for confirmation before they run.")}
                </span>
              </div>
            }
          >
            <button
              type="button"
              onClick={onPermissionModeToggle}
              aria-label={permissionFullAccess ? t("Allow full access") : t("Confirm dangerous commands")}
              aria-pressed={permissionFullAccess}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, padding: 0, flexShrink: 0,
                background: permissionFullAccess
                  ? `color-mix(in srgb, ${FULL_ACCESS_RED} 16%, transparent)`
                  : "none",
                border: "none",
                borderRadius: "50%",
                color: permissionFullAccess ? FULL_ACCESS_RED : "var(--text-muted)",
                cursor: "pointer",
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = permissionFullAccess
                  ? `color-mix(in srgb, ${FULL_ACCESS_RED} 24%, transparent)`
                  : "var(--bg-hover)";
                e.currentTarget.style.color = permissionFullAccess ? FULL_ACCESS_RED : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = permissionFullAccess
                  ? `color-mix(in srgb, ${FULL_ACCESS_RED} 16%, transparent)`
                  : "none";
                e.currentTarget.style.color = permissionFullAccess ? FULL_ACCESS_RED : "var(--text-muted)";
              }}
            >
              <ICONS.shield size={15} strokeWidth={1.9} />
            </button>
          </Tooltip>
        )}
        {showNotifyPicker && onNotifyChannelChange && (
          <NewSessionNotifyPicker
            value={notifyChannelId}
            onChange={onNotifyChannelChange}
          />
        )}
        <MoreMenu collapsedItems={collapsedEntries} />
      </div>
    </div>
  );
}
function ToolsIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14.7 6a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}
