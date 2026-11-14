"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, useMemo, forwardRef, KeyboardEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { ChatInputAttachments } from "./ChatInputAttachments";
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
import { VoiceInputButton } from "./chat-input/VoiceInputButton";
import { useVoiceInput, type VoiceRecorderFactory } from "./chat-input/hooks/useVoiceInput";
import { BUILTIN_SLASH_ACTIONS, THINKING_BORDER_COLOR } from "./chat-input/constants";
import { chatInputMetrics, VOICE_INPUT_ACCENT_COLOR, voiceInputMetrics } from "./chat-input/metrics";
import { canToggleVoiceInput } from "@/lib/shared/chat-shortcuts";
import { canCancelVoiceInput, decideVoiceInputEscape, voiceInputErrorMessageKey } from "@/lib/shared/voice-input";
import { decideSuggestedPromptTab } from "@/lib/shared/suggested-prompt";
import { selectSuggestedPromptPlaceholder } from "@/lib/client/suggested-prompt-state";
import { createComposerPicker } from "@/lib/client/composer-picker";
import { createFileMentionAdapter } from "@/lib/client/file-mentions-io";
import type { SessionPermissionMode } from "@/lib/shared/permission-mode";

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
  permissionMode?: SessionPermissionMode;
  onPermissionModeToggle?: () => void;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  suggestedPrompt?: string | null;
  slashResources?: SlashResource[];
  slashResourceKey?: string;
  onSlashAction?: (action: string) => void;
  onOpenSkillsPanel?: () => void;
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
  voiceRecorderFactory?: VoiceRecorderFactory;
  voiceInputShortcutActive?: boolean;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
  focus: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, isStreaming, sessionBusy = false, model, modelNames, modelIcons, modelList, onModelChange,
  toolSelection = "all", onToolSelectionChange,
  availableTools = [], toolsLoading = false, toolsError = null, onEnsureAvailableTools,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  permissionMode = "confirm", onPermissionModeToggle,
  retryInfo,
  suggestedPrompt = null,
  slashResources = [], slashResourceKey,
  onSlashAction,
  onOpenSkillsPanel,
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
  voiceRecorderFactory,
  voiceInputShortcutActive = true,
}: Props, ref) {
  const { t } = useI18n();
  const { contextUsage, sessionStats, contextComposition } = useSessionUiState();

  const [value, setValue] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerPicker = useMemo(
    () => createComposerPicker({ fileAdapter: createFileMentionAdapter(cwd ?? "") }),
    [cwd],
  );

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

  const fillDraft = useCallback((text: string) => {
    setValue(text);
    setCursorPosition(text.length);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, chatInputMetrics.textAreaMaxHeight)}px`;
    });
  }, []);

  const fillFromHistory = useCallback(
    (text: string) => {
      fillDraft(text);
      clearImages();
    },
    [clearImages, fillDraft],
  );

  const insertTextAtCursor = useCallback((text: string) => {
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
      ta.style.height = `${Math.min(ta.scrollHeight, chatInputMetrics.textAreaMaxHeight)}px`;
    });
  }, []);

  const voiceInput = useVoiceInput({
    insertText: insertTextAtCursor,
    sessionKey: sessionId,
    recorderFactory: voiceRecorderFactory,
  });

  const voiceInputSupported = voiceInput.supported;
  const voiceInputPhase = voiceInput.phase;
  const toggleVoiceInput = voiceInput.toggle;
  const cancelVoiceInput = voiceInput.cancel;

  useEffect(() => {
    if (!voiceInputShortcutActive || !voiceInputSupported) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!canToggleVoiceInput({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        menuOpen: slashMenuOpen || mentionMenuOpen,
        phase: voiceInputPhase,
        disabled,
        supported: voiceInputSupported,
      })) return;
      event.preventDefault();
      void toggleVoiceInput();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    voiceInputShortcutActive,
    voiceInputSupported,
    voiceInputPhase,
    toggleVoiceInput,
    slashMenuOpen,
    mentionMenuOpen,
    disabled,
  ]);

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
    if (canCancelVoiceInput(voiceInputPhase)) void cancelVoiceInput();
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
  }, [value, attachedImages, isStreaming, onSend, clearImages, buildMessage, exitHistoryMode, setSelectedSlashResource, setSlashMenuOpen, voiceInputPhase, cancelVoiceInput]);

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, chatInputMetrics.textAreaMaxHeight)}px`;
  }, []);

  const handleEnterAndBuiltin = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return false;
      if (!(e.ctrlKey || e.metaKey) && !enterToSend) return false;
      const trimmed = value.trim();
      const builtinAction = BUILTIN_SLASH_ACTIONS.find((item) => trimmed === `/${item.command}`);
      if (builtinAction) {
        onSlashAction?.(builtinAction.command);
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

  const handleSuggestedPromptTab = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== "Tab" || e.nativeEvent.isComposing) return false;
      const decision = decideSuggestedPromptTab({ inputText: value, suggestion: suggestedPrompt });
      if (decision.kind !== "adopt") return false;
      e.preventDefault();
      fillDraft(decision.text);
      return true;
    },
    [value, suggestedPrompt, fillDraft],
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

  const handleVoiceEscape = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== "Escape") return false;
      const action = decideVoiceInputEscape({
        menuOpen: slashMenuOpen || mentionMenuOpen,
        phase: voiceInputPhase,
      });
      if (action !== "cancel") return false;
      e.preventDefault();
      void cancelVoiceInput();
      return true;
    },
    [slashMenuOpen, mentionMenuOpen, voiceInputPhase, cancelVoiceInput],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleShiftBackspaceClear(e)) return;
      if (handleSuggestedPromptTab(e)) return;
      if (handleFileMentionKeyDown(e)) return;
      if (handleSlashKeyDown(e)) return;
      if (handleSlashEscape(e)) return;
      if (handleVoiceEscape(e)) return;
      if (handleHistoryKeyDown(e)) return;
      handleEnterAndBuiltin(e);
    },
    [handleShiftBackspaceClear, handleSuggestedPromptTab, handleFileMentionKeyDown, handleSlashKeyDown, handleSlashEscape, handleVoiceEscape, handleHistoryKeyDown, handleEnterAndBuiltin],
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
        ta.style.height = `${Math.min(ta.scrollHeight, chatInputMetrics.textAreaMaxHeight)}px`;
      });
    },
    insertText(text: string) {
      insertTextAtCursor(text);
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
        padding: chatInputMetrics.containerPadding,
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
      <div style={{ maxWidth: 820, margin: "0 auto", position: "relative" }}>
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: chatInputMetrics.retryBarPadding,
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width={chatInputMetrics.retryIcon} height={chatInputMetrics.retryIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            {t("Retrying")} ({retryInfo.attempt}/{retryInfo.maxAttempts})…{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {voiceInput.error && (
          <div
            role="status"
            style={{
              marginBottom: voiceInputMetrics.errorMarginBottom,
              fontSize: voiceInputMetrics.errorFont,
              color: VOICE_INPUT_ACCENT_COLOR,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {t(voiceInputErrorMessageKey(voiceInput.error))}
          </div>
        )}
        {!hideToolbar && (
          <ChatInputAttachments
            images={attachedImages}
            selectedSlashResource={selectedSlashResource}
            onRemoveImage={removeImage}
            onRemoveSlashResource={() => setSelectedSlashResource(null)}
          />
        )}

        <CollapsiblePanel open={true}>
        <div
          style={{
            display: "flex",
            gap: chatInputMetrics.boxGap,
            alignItems: "center",
            background: "var(--bg)",
            border: `1.5px solid ${THINKING_BORDER_COLOR[thinkingLevel ?? "off"]}`,
            borderRadius: chatInputMetrics.boxBorderRadius,
            padding: chatInputMetrics.boxPadding,
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
            placeholder={selectSuggestedPromptPlaceholder({
              suggestion: suggestedPrompt,
              inputText: value,
              fallback: t("Type / to select a skill, @ to select a file"),
            })}
            disabled={disabled}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: chatInputMetrics.font,
              lineHeight: chatInputMetrics.lineHeight,
              fontFamily: "inherit",
              minHeight: chatInputMetrics.textAreaMinHeight,
              maxHeight: chatInputMetrics.textAreaMaxHeight,
              overflow: "auto",
            }}
            data-hide-v-scrollbar
          />

          {voiceInput.supported && (
            <VoiceInputButton
              phase={voiceInput.phase}
              elapsedMs={voiceInput.elapsedMs}
              level={voiceInput.level}
              disabled={disabled}
              onClick={() => {
                void voiceInput.toggle();
              }}
            />
          )}

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
                width: chatInputMetrics.sendButton, height: chatInputMetrics.sendButton, padding: 0,
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
              <svg width={chatInputMetrics.stopIcon} height={chatInputMetrics.stopIcon} viewBox="0 0 10 10" fill="none">
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
                width: chatInputMetrics.sendButton, height: chatInputMetrics.sendButton, padding: 0,
                background: canSend ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: "50%",
                color: canSend ? "#fff" : "var(--text-dim)",
                cursor: canSend ? "pointer" : "not-allowed",
                boxShadow: canSend ? "0 1px 3px rgba(37,99,235,0.25)" : "none",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            >
              <svg width={chatInputMetrics.sendIcon} height={chatInputMetrics.sendIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="13" x2="8" y2="4" />
                <polyline points="4 7.5 8 3.5 12 7.5" />
              </svg>
            </button>
          )}
        </div>
        </CollapsiblePanel>
        {(slashMenuOpen && slashQuery || mentionMenuOpen && mentionQuery) && !hideToolbar && (
          <div style={{ position: "relative" }}>
            {slashMenuOpen && slashQuery && (
              <div style={{
                position: "absolute", bottom: `calc(100% + ${chatInputMetrics.menuOffset}px)`, left: 0,
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
                position: "absolute", bottom: `calc(100% + ${chatInputMetrics.menuOffset}px)`, left: 0,
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
            composerPicker={composerPicker}
            onPickComposerImage={() => fileInputRef.current?.click()}
            onSelectComposerSkill={selectSlashResource}
            onInsertComposerText={insertTextAtCursor}
            onOpenSkillsPanel={onOpenSkillsPanel}
            composerSlashResources={slashResources}
            model={model}
            modelNames={modelNames}
            modelIcons={modelIcons}
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