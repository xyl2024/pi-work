"use client";

import { useState, type RefObject } from "react";
import { Tooltip } from "../../ui/Tooltip";
import { ContextUsageBar } from "../ContextUsageBar";
import { CwdPicker } from "../../sessions/CwdPicker";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "../../ui/ProviderIcon";
import { ModelPickerModal } from "../ModelPickerModal";
import { ToolsPickerModal } from "../ToolsPickerModal";
import { ThinkingPicker, THINKING_LEVEL_COLOR, type ThinkingLevel } from "../ThinkingPicker";
import { MoreMenu } from "../MoreMenu";
import { ICONS } from "../../ui/icons";
import { FULL_ACCESS_RED } from "../../ui/permission-mode-colors";
import { NewSessionNotifyPicker } from "../chat-window/NewSessionNotifyPicker";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import type { PermissionMode } from "@/lib/shared/permission-mode";
import type { ContextUsage, SessionStats } from "@/hooks/sessionUiStore";
import type { ContextComposition } from "@/lib/shared/context-composition";

type ThinkingLevelOption = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface BottomToolbarProps {
  /** i18n function — wired from the parent's `useI18n`. */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** True while the agent is mid-turn. Gates model/cwd pickers, upload, and
   *  the thinking/tools affordances (they swap for read-only badges). */
  isStreaming: boolean;

  // LEFT side
  onSlashAction?: (action: string) => void;
  /** True if at least one image is attached. Drives the upload button's
   *  "accent" variant so the user can see at a glance whether they have
   *  images queued. */
  hasAttachedImages: boolean;
  /** Hidden file input ref. The upload button calls `.click()` on it. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  model?: { provider: string; modelId: string } | null;
  modelNames?: Record<string, string>;
  /** "<provider>:<modelId>" → provider id map from /api/models. */
  modelIcons?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; reasoning?: boolean; input?: string[]; contextWindow?: number; maxTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }[];
  onModelChange?: (provider: string, modelId: string) => void;
  cwd?: string | null;
  onCwdChange?: (cwd: string) => void;

  // MIDDLE
  contextUsage: ContextUsage | null;
  contextComposition: ContextComposition | null;
  sessionStats: SessionStats;

  // RIGHT - permission mode (ADR-0021). The button is only offered when the
  // handler exists — a draft has no session, and a draft is always `confirm`.
  permissionMode?: PermissionMode;
  onPermissionModeToggle?: () => void;

  // RIGHT - thinking
  thinkingLevel?: ThinkingLevelOption;
  onThinkingLevelChange?: (level: ThinkingLevelOption) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;

  // RIGHT - tools preset dropdown
  toolSelection: ToolSelection;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  /** Compatibility ref retained for the parent; the picker itself is a modal. */
  toolDropdownRef: RefObject<HTMLDivElement | null>;
  toolDropdownOpen: boolean;
  setToolDropdownOpen: (open: boolean) => void;
  onToolSelectionChange?: (selection: ToolSelection) => void;
  onEnsureAvailableTools?: () => Promise<void>;
  customExpanded: boolean;
  /** Flip the Custom row's expand state. Parent decides whether to fire
   *  `onEnsureAvailableTools` on the first expand (so the catalog fetch
   *  is triggered exactly once per session). */
  toggleCustomExpanded: () => void;

  // RIGHT - notify channel (empty new-session screen only)
  /** Show the icon-only notification-channel picker right of the tools
   *  picker. Only the parent knows whether the session is still empty; a
   *  session with messages binds its channel through the More menu. */
  showNotifyPicker?: boolean;
  notifyChannelId?: string | null;
  onNotifyChannelChange?: (channelId: string | null) => void;
}

/**
 * Bottom toolbar beneath the textarea: LEFT (new session + upload + model +
 * cwd), MIDDLE (context usage), RIGHT (thinking + tools + notify + more).
 *
 * No abort affordance here: while streaming the send button in the input row
 * turns into the red stop button.
 *
 * Pure presentational — every state/derivative the JSX needs comes from
 * props. The corresponding state machine (slash menu, history, tools
 * dropdown, etc.) lives in the parent's hooks; this component only reads.
 */
export function BottomToolbar(props: BottomToolbarProps) {
  const {
    t,
    isStreaming,
    onSlashAction,
    hasAttachedImages,
    fileInputRef,
    model, modelNames, modelIcons, modelList, onModelChange,
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

  // Model selection now goes through the same `/model` modal as the slash
  // command — the toolbar button is just a trigger that opens it.
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [toolsPickerOpen, setToolsPickerOpen] = useState(false);

  // Hide the trigger entirely when no models are available (matches the
  // old ModelPicker's gating), and resolve the display name for it.
  const modelOptionsEmpty = (modelList?.length ?? 0) === 0 && Object.keys(modelNames ?? {}).length === 0;
  const currentModelName = model
    ? (modelList?.find((m) => m.id === model.modelId && m.provider === model.provider)?.name
       ?? modelNames?.[model.modelId]
       ?? model.modelId)
    : null;

  // Full metadata row for the current model, if the list carries it —
  // surfaced in the trigger's hover tooltip (context window / max output).
  const currentModelMeta = model
    ? modelList?.find((m) => m.id === model.modelId && m.provider === model.provider)
    : undefined;
  const formatTokens = (n: number): string =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(0)}k`
        : String(n);
  // Cost is quoted per million tokens — render if/when the catalog carries it.
  const formatCost = (n: number): string => `$${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}`;

  // Tooltip metadata grid, mirroring the fields shown in the Models settings
  // page (context window, max output, reasoning/thinking, image input, cost).
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

  // Current thinking level's display label for the streaming badge —
  // the same mapped value the picker button shows.
  const currentThinkingLevel: ThinkingLevel = (thinkingLevel ?? "off") as ThinkingLevel;
  const currentThinkingMapped = thinkingLevelMap
    ? thinkingLevelMap[currentThinkingLevel]
    : undefined;
  const currentThinkingDisplay = currentThinkingMapped != null && currentThinkingMapped !== currentThinkingLevel
    ? currentThinkingMapped
    : currentThinkingLevel;

  // `onToolSelectionChange` is optional on Props (older call sites), so an
  // explicit no-op keeps the inline toggle callback total.
  const handleToolSelectionChangeLocal = onToolSelectionChange ?? (() => {});

  // The shield button's two states. `confirm` is the default and must not look
  // "on" — an inactive-looking control plus a red one makes the current mode
  // readable without reading the tooltip.
  const permissionFullAccess = permissionMode === "full_access";

  return (
    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
      {/* LEFT: attach + model selector */}
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 2 }}>
        {/* New session — circular icon button. Same action as the /new
            slash command: starts a fresh session in the current cwd
            (selected session's cwd, or the in-flight new-session cwd). */}
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
        {/* Model selector — visible always, disabled during streaming.
            Opens the `/model` picker modal (grid + keyboard navigation)
            instead of an inline dropdown. Hidden when no models exist.
            Hovering shows the current model's metadata (context window,
            max output) from /api/models. The trigger is wrapped in a span
            so the tooltip still fires while the button is disabled. */}
        {!modelOptionsEmpty && (
          <Tooltip
            content={modelMetaTooltip}
            interactive
            maxWidth={420}
          >
          <span style={{ display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setModelPickerOpen(true)}
            disabled={isStreaming}
            aria-label={t("Switch model")}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 12px",
              height: 32,
              maxWidth: 220, overflow: "hidden",
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
              id={resolveProviderIcon(model?.provider, model?.modelId, modelIcons) ?? ""}
              size={12}
              fallback={<ProviderGearIcon size={11} />}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{currentModelName}</span>
          </button>
          </span>
          </Tooltip>
        )}
        <ModelPickerModal
          open={modelPickerOpen}
          model={model ?? null}
          modelNames={modelNames}
          modelIcons={modelIcons}
          modelList={modelList}
          disabled={isStreaming}
          onModelChange={onModelChange}
          onClose={() => setModelPickerOpen(false)}
        />

        {/* CWD picker — always visible (new-session flow picks the project;
            during a session it mirrors the model selector: disabled while
            the agent is running, clickable when idle to switch projects). */}
        {onCwdChange && (
          <CwdPicker
            cwd={cwd ?? null}
            onCwdChange={onCwdChange}
            disabled={isStreaming}
            dropdownDirection="up"
          />
        )}
      </div>

      {/* spacer */}
      <div style={{ flex: 1 }} />

      {contextUsage && (
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 4 }}>
          {/* Cumulative token stats (input / output / cache hit rate / cost)
              are surfaced in the context bar's hover tooltip. The previous
              inline strip was removed so the input row stays compact. */}
          <ContextUsageBar contextUsage={contextUsage} sessionStats={sessionStats} contextComposition={contextComposition} />
        </div>
      )}

      {/* RIGHT: thinking + tools preset | More */}
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 2, marginLeft: "auto" }}>
        {/* Streaming: show the chosen thinking level as a read-only
            badge instead of the icon button (the level can't be changed
            while the agent is running). */}
        {isStreaming && (
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              height: 32, padding: "0 10px",
              fontSize: 12, color: THINKING_LEVEL_COLOR[currentThinkingLevel],
              background: "none", border: "none", borderRadius: 9,
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
              <line x1="7" y1="18" x2="12" y2="18" />
              <line x1="8" y1="21" x2="11" y2="21" />
            </svg>
            {currentThinkingDisplay}
          </span>
        )}
        {!isStreaming && onThinkingLevelChange && (
          <ThinkingPicker
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={onThinkingLevelChange}
            availableThinkingLevels={availableThinkingLevels}
            thinkingLevelMap={thinkingLevelMap}
          />
        )}
        {!isStreaming && (
          <div ref={toolDropdownRef}>
            <button
              type="button"
              onClick={() => setToolsPickerOpen(true)}
              aria-label={t("Tools")}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "0 10px", height: 32,
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
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M14.7 6a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              <span style={{ whiteSpace: "nowrap" }}>
                {t("Tools")}
              </span>
            </button>
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
          </div>
        )}
        {onPermissionModeToggle && (
          // The tooltip is the whole explanation: the label alone would not say
          // what full access lets through, and "it stopped asking" is exactly
          // the impression that needs the boundary spelled out.
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
        <MoreMenu />
      </div>
    </div>
  );
}