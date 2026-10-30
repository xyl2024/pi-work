"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { AttachmentList } from "./AttachmentList";
import { SlashCommandHint } from "./SlashCommandHint";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { FileMentionMenu } from "./FileMentionMenu";
import { CollapsiblePanel } from "../ui/CollapsiblePanel";
import { findDirectSlashResource, formatSlashContent, type SlashResource } from "@/lib/shared/slash-commands";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import { useImageAttachments } from "./chat-input/hooks/useImageAttachments";
import { useInputHistory } from "./chat-input/hooks/useInputHistory";
import { useToolsDropdown } from "./chat-input/hooks/useToolsDropdown";
import { useSlashMenu } from "./chat-input/hooks/useSlashMenu";
import { useFileMentionMenu } from "./chat-input/hooks/useFileMentionMenu";
import { BottomToolbar } from "./chat-input/BottomToolbar";
import { THINKING_BORDER_COLOR } from "./chat-input/constants";
import { FULL_ACCESS_BORDER_COLOR } from "../ui/permission-mode-colors";
import type { PermissionMode } from "@/lib/shared/permission-mode";
import { THINKING_LEVEL_ORDER, type ThinkingLevelOption } from "@/lib/shared/thinking-level-utils";

export type { SlashResource } from "@/lib/shared/slash-commands";
export type { AttachedImage } from "./chat-input/types";

import type { AttachedImage } from "./chat-input/types";

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  isStreaming: boolean;
  sessionBusy?: boolean;
  model?: { provider: string; modelId: string } | null;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; reasoning?: boolean; input?: string[]; contextWindow?: number; maxTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }[];
  onModelChange?: (provider: string, modelId: string) => void;
  toolSelection?: ToolSelection;
  onToolSelectionChange?: (selection: ToolSelection) => void;
  availableTools?: ToolInfo[];
  toolsLoading?: boolean;
  toolsError?: string | null;
  onEnsureAvailableTools?: () => Promise<void>;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  permissionMode?: PermissionMode;
  onPermissionModeToggle?: () => void;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  slashResources?: SlashResource[];
  slashResourceKey?: string;
  onSlashAction?: (action: string) => void;
  cwd?: string | null;
  onCwdChange?: (cwd: string) => void;
  sessionId?: string | null;
  userMessageHistory?: string[];
  onDraftChange?: (draft: {
    dirty: boolean;
    text: string;
    imageCount: number;
    cursorPosition: number;
  }) => void;
  enterToSend?: boolean;
  hideToolbar?: boolean;
  disabled?: boolean;
  showNotifyPicker?: boolean;
  notifyChannelId?: string | null;
  onNotifyChannelChange?: (channelId: string | null) => void;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
  focus: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, isStreaming, sessionBusy = false, model, modelNames, modelIcons, modelIconPreferences, modelList, onModelChange,
  toolSelection = "all", onToolSelectionChange,
  availableTools = [], toolsLoading = false, toolsError = null, onEnsureAvailableTools,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  permissionMode = "confirm", onPermissionModeToggle,
  retryInfo,
  slashResources = [], slashResourceKey,
  onSlashAction,
  cwd,
  onCwdChange,
  sessionId,
  userMessageHistory,
  onDraftChange,
  enterToSend = false,
  hideToolbar = false,
  disabled = false,
  showNotifyPicker = false,
  notifyChannelId = null,
  onNotifyChannelChange,
}: Props, ref) {
  const { t } = useI18n();
  const { contextUsage, sessionStats, contextComposition } = useSessionUiState();

  const [value, setValue] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    attachedImages,
    fileInputRef,
    processImageFiles,
    removeImage,
    clearImages,
    handlePaste,
  } = useImageAttachments();

  const {
    selectedSlashResource,
    slashMenuOpen,
    slashActiveIndex,
    slashQuery,
    visibleSlashResources,
    setSlashMenuOpen,
    setSelectedSlashResource,
    selectSlashResource,
    handleSlashKeyDown,
    syncSlashMenuForEdit,
  } = useSlashMenu({
    slashResourceKey,
    slashResources,
    onSlashAction,
    value,
    cursorPosition,
    setValue,
    setCursorPosition,
    textareaRef,
  });
  const {
    mentionMenuOpen,
    mentionActiveIndex,
    mentionQuery,
    visibleMentionEntries,
    mentionPageCount,
    mentionCurrentPage,
    loading: mentionLoading,
    error: mentionError,
    syncFileMentionMenuForEdit,
    handleFileMentionKeyDown,
    selectFileMention,
    retryFileMentionLoad,
  } = useFileMentionMenu({ cwd, value, cursorPosition, setValue, setCursorPosition, textareaRef });

  const syncInputMenus = useCallback((nextValue: string, cursor: number) => {
    const mentionActive = Boolean(cwd && nextValue.slice(0, cursor).match(/(^|\s)@[^\s]*$/));
    if (mentionActive) setSlashMenuOpen(false);
    else syncSlashMenuForEdit(nextValue, cursor);
    syncFileMentionMenuForEdit(nextValue, cursor);
  }, [cwd, setSlashMenuOpen, syncSlashMenuForEdit, syncFileMentionMenuForEdit]);

  const {
    toolDropdownOpen,
    customExpanded,
    toolDropdownRef,
    setToolDropdownOpen,
    toggleCustomExpanded,
  } = useToolsDropdown();

  const fillFromHistory = useCallback(
    (text: string) => {
      setValue(text);
      setCursorPosition(text.length);
      clearImages();
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(text.length, text.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    [clearImages],
  );
  const {
    isInHistoryMode,
    exitHistoryMode,
    handleHistoryKeyDown,
  } = useInputHistory({
    sessionId,
    userMessageHistory,
    value,
    navigateTo: fillFromHistory,
    textareaRef,
  });

  useEffect(() => {
    onDraftChange?.({
      dirty: Boolean(value.trim() || attachedImages.length || selectedSlashResource),
      text: value,
      imageCount: attachedImages.length,
      cursorPosition,
    });
  }, [value, attachedImages.length, selectedSlashResource, cursorPosition, onDraftChange]);

  const buildMessage = useCallback(
    (rawMessage: string) => {
      const msg = rawMessage.trim();
      if (selectedSlashResource) {
        return formatSlashContent(selectedSlashResource, msg);
      }
      const directSlash = findDirectSlashResource(msg, slashResources);
      if (directSlash) {
        return formatSlashContent(directSlash.item, directSlash.args);
      }
      return msg;
    },
    [selectedSlashResource, slashResources],
  );

  const handleSend = useCallback(() => {
    const msg = buildMessage(value);
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onSend(msg, attachedImages.length ? attachedImages : undefined);
    exitHistoryMode();
    setValue("");
    setCursorPosition(0);
    setSelectedSlashResource(null);
    setSlashMenuOpen(false);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, attachedImages, isStreaming, onSend, clearImages, buildMessage, exitHistoryMode, setSelectedSlashResource, setSlashMenuOpen]);

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handleEnterAndBuiltin = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return false;
      if (!(e.ctrlKey || e.metaKey) && !enterToSend) return false;
      const trimmed = value.trim();
      if (trimmed === "/new" || trimmed === "/compact" || trimmed === "/model") {
        const action = trimmed.slice(1);
        onSlashAction?.(action);
        setValue("");
        setCursorPosition(0);
        setSelectedSlashResource(null);
        setSlashMenuOpen(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        return true;
      }
      e.preventDefault();
      handleSend();
      return true;
    },
    [value, onSlashAction, handleSend, setSelectedSlashResource, setSlashMenuOpen, enterToSend],
  );

  const handleShiftBackspaceClear = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!(selectedSlashResource && e.shiftKey && e.key === "Backspace")) return false;
      e.preventDefault();
      setSelectedSlashResource(null);
      return true;
    },
    [selectedSlashResource, setSelectedSlashResource],
  );

  const handleThinkingTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== "Tab" || e.nativeEvent.isComposing) return false;
      if (!onThinkingLevelChange) return false;
      const available = availableThinkingLevels ?? null;
      const list: readonly ThinkingLevelOption[] = THINKING_LEVEL_ORDER.filter(
        (lvl) => (available ? available.includes(lvl) : true),
      );
      if (list.length === 0) return false;
      const direction: 1 | -1 = e.shiftKey ? -1 : 1;
      const current = (thinkingLevel ?? "off") as ThinkingLevelOption;
      const idx = list.indexOf(current);
      const nextIdx = ((idx + direction) % list.length + list.length) % list.length;
      const nextLevel = list[nextIdx];
      e.preventDefault();
      if (nextLevel !== current) onThinkingLevelChange(nextLevel);
      return true;
    },
    [thinkingLevel, onThinkingLevelChange, availableThinkingLevels],
  );

  const handleSlashEscape = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!(slashMenuOpen && e.key === "Escape")) return false;
      e.preventDefault();
      setSlashMenuOpen(false);
      return true;
    },
    [slashMenuOpen, setSlashMenuOpen],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleShiftBackspaceClear(e)) return;
      if (handleThinkingTabKeyDown(e)) return;
      if (handleFileMentionKeyDown(e)) return;
      if (handleSlashKeyDown(e)) return;
      if (handleSlashEscape(e)) return;
      if (handleHistoryKeyDown(e)) return;
      handleEnterAndBuiltin(e);
    },
    [handleShiftBackspaceClear, handleThinkingTabKeyDown, handleFileMentionKeyDown, handleSlashKeyDown, handleSlashEscape, handleHistoryKeyDown, handleEnterAndBuiltin],
  );

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      setValue(newVal);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      void processImageFiles(files);
    },
    focus() {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
    },
  }));

  const canSend = !disabled && !sessionBusy && (!!value.trim() || attachedImages.length > 0 || !!selectedSlashResource);

  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 8px",
      }}
    >
      {!hideToolbar && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            void processImageFiles(files);
            e.target.value = "";
          }}
        />
      )}
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            {t("Retrying")} ({retryInfo.attempt}/{retryInfo.maxAttempts})…{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {!hideToolbar && <AttachmentList images={attachedImages} onRemove={removeImage} />}

        <CollapsiblePanel open={true}>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--bg)",
            border: `1.5px solid ${permissionMode === "full_access" ? FULL_ACCESS_BORDER_COLOR : THINKING_BORDER_COLOR[thinkingLevel ?? "off"]}`,
            borderRadius: 14,
            padding: "10px 10px 10px 14px",
            boxShadow: "none",
            transition: "border-color 0.15s, background 0.15s",
            position: "relative",
          } as React.CSSProperties}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              const pos = e.target.selectionStart ?? e.target.value.length;
              setCursorPosition(pos);
              syncInputMenus(e.target.value, pos);
              if (isInHistoryMode) {
                exitHistoryMode();
              }
            }}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={hideToolbar ? undefined : handlePaste}
            onSelect={(e) => {
              const pos = e.currentTarget.selectionStart ?? value.length;
              setCursorPosition(pos);
              syncInputMenus(e.currentTarget.value, pos);
            }}
            onFocus={(e) => {
              const pos = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
              setCursorPosition(pos);
              syncInputMenus(e.currentTarget.value, pos);
            }}
            rows={1}
            disabled={disabled}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: "inherit",
              minHeight: 24,
              maxHeight: 200,
              overflow: "auto",
            }}
            data-hide-v-scrollbar
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onAbort}
              disabled={disabled}
              aria-label={t("Stop")}
              title={t("Stop")}
              style={{
                flexShrink: 0,
                alignSelf: "flex-end",
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, padding: 0,
                background: "#ef4444",
                border: "none",
                borderRadius: "50%",
                color: "#fff",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
                boxShadow: "0 1px 3px rgba(239,68,68,0.35)",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "#dc2626"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#ef4444"; }}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label={t("Send")}
              style={{
                flexShrink: 0,
                alignSelf: "flex-end",
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, padding: 0,
                background: canSend ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: "50%",
                color: canSend ? "#fff" : "var(--text-dim)",
                cursor: canSend ? "pointer" : "not-allowed",
                boxShadow: canSend ? "0 1px 3px rgba(37,99,235,0.25)" : "none",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="13" x2="8" y2="4" />
                <polyline points="4 7.5 8 3.5 12 7.5" />
              </svg>
            </button>
          )}
        </div>
        </CollapsiblePanel>
        {(selectedSlashResource || (slashMenuOpen && slashQuery) || (mentionMenuOpen && mentionQuery)) && !hideToolbar && (
          <div style={{ position: "relative" }}>
            {selectedSlashResource && (
              <SlashCommandHint resource={selectedSlashResource} onRemove={() => setSelectedSlashResource(null)} />
            )}
            {slashMenuOpen && slashQuery && (
              <div style={{
                position: "absolute", bottom: "calc(100% + 44px)", left: 0,
                zIndex: 200, width: "min(560px, 100%)",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                overflow: "hidden",
              }}>
                <SlashCommandMenu
                  items={visibleSlashResources}
                  activeIndex={slashActiveIndex}
                  onSelect={selectSlashResource}
                />
              </div>
            )}
            {mentionMenuOpen && mentionQuery && (
              <div style={{
                position: "absolute", bottom: "calc(100% + 44px)", left: 0,
                zIndex: 200, width: "min(560px, 100%)", maxHeight: 320,
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                overflow: "auto",
              }}>
                <FileMentionMenu
                  items={visibleMentionEntries}
                  activeIndex={mentionActiveIndex}
                  loading={mentionLoading}
                  error={mentionError}
                  onSelect={selectFileMention}
                  onRetry={retryFileMentionLoad}
                  page={mentionCurrentPage}
                  pageCount={mentionPageCount}
                />
              </div>
            )}
          </div>
        )}

        {!hideToolbar && (
          <BottomToolbar
            t={t}
            isStreaming={isStreaming}
            onSlashAction={onSlashAction}
            hasAttachedImages={attachedImages.length > 0}
            fileInputRef={fileInputRef}
            model={model}
            modelNames={modelNames}
            modelIcons={modelIcons}
            modelIconPreferences={modelIconPreferences}
            modelList={modelList}
            onModelChange={onModelChange}
            cwd={cwd}
            onCwdChange={onCwdChange}
            contextUsage={contextUsage}
            sessionStats={sessionStats}
            contextComposition={contextComposition}
            permissionMode={permissionMode}
            onPermissionModeToggle={onPermissionModeToggle}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={onThinkingLevelChange}
            availableThinkingLevels={availableThinkingLevels}
            thinkingLevelMap={thinkingLevelMap}
            toolSelection={toolSelection ?? "all"}
            availableTools={availableTools ?? []}
            toolsLoading={toolsLoading ?? false}
            toolsError={toolsError ?? null}
            toolDropdownRef={toolDropdownRef}
            toolDropdownOpen={toolDropdownOpen}
            setToolDropdownOpen={setToolDropdownOpen}
            onToolSelectionChange={onToolSelectionChange}
            onEnsureAvailableTools={onEnsureAvailableTools}
            customExpanded={customExpanded}
            toggleCustomExpanded={() => toggleCustomExpanded(() => onEnsureAvailableTools?.())}
            showNotifyPicker={showNotifyPicker}
            notifyChannelId={notifyChannelId}
            onNotifyChannelChange={onNotifyChannelChange}
          />
        )}
      </div>
    </div>
  );
});