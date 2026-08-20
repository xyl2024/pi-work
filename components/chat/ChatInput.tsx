"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { AttachmentList } from "./AttachmentList";
import { SlashCommandHint } from "./SlashCommandHint";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { PromptPreview } from "./PromptPreview";
import { Typewriter } from "../ui/Typewriter";
import { CollapsiblePanel } from "../ui/CollapsiblePanel";
import { findDirectSlashResource, formatSlashContent, type SlashResource } from "@/lib/shared/slash-commands";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import { useTypewriterPhrases } from "./chat-input/hooks/useTypewriterPhrases";
import { useImageAttachments } from "./chat-input/hooks/useImageAttachments";
import { useInputHistory } from "./chat-input/hooks/useInputHistory";
import { useToolsDropdown } from "./chat-input/hooks/useToolsDropdown";
import { useSlashMenu } from "./chat-input/hooks/useSlashMenu";
import { BottomToolbar } from "./chat-input/BottomToolbar";
import { THINKING_BORDER_COLOR } from "./chat-input/constants";
import { THINKING_LEVEL_ORDER, type ThinkingLevelOption } from "@/lib/shared/thinking-level-utils";

export type { SlashResource } from "@/lib/shared/slash-commands";
export type { AttachedImage } from "./chat-input/types";

// Re-exported so existing consumers (AttachmentList, useAgentSession types)
// can keep importing the type from "./ChatInput" without churn.
import type { AttachedImage } from "./chat-input/types";

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  isStreaming: boolean;
  /** True while the session is mid-turn (including compaction). Same gate
   *  as `isStreaming`, exposed separately so a parent can disable just the
   *  submit affordance without forcing the rest of the input into a
   *  streaming-only mode (e.g. compacting disables only the send button,
   *  not the textarea or model selector). */
  sessionBusy?: boolean;
  model?: { provider: string; modelId: string } | null;
  modelNames?: Record<string, string>;
  /** Custom-model icon map ("<provider>:<modelId>" → provider id), from /api/models. */
  modelIcons?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  onModelChange?: (provider: string, modelId: string) => void;
  /** The user's tool selection state. `[]` ≡ Off, `"all"` ≡ High, partial
   *  array ≡ Custom. Mutually consistent with the wire format of `set_tools`. */
  toolSelection?: ToolSelection;
  /** Apply a new tool selection. For existing sessions this fires `set_tools`
   *  against the agent; for new sessions it just updates local state and the
   *  selection is serialised into the first prompt's `toolNames`. */
  onToolSelectionChange?: (selection: ToolSelection) => void;
  /** Catalog of every tool pi would register for this session's cwd. Sorted
   *  alphabetically. Empty until `onEnsureAvailableTools()` resolves. */
  availableTools?: ToolInfo[];
  /** True while the catalog is being fetched. The Custom row renders a
   *  spinner in its checklist area while this is true. */
  toolsLoading?: boolean;
  /** Last catalog-fetch error message, surfaced inline in the checklist area
   *  with a Retry button that re-invokes `onEnsureAvailableTools`. */
  toolsError?: string | null;
  /** Lazy catalog fetcher. The Custom row calls this the first time it's
   *  expanded per session if the catalog is empty. */
  onEnsureAvailableTools?: () => Promise<void>;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  slashResources?: SlashResource[];
  slashResourceKey?: string;
  onSlashAction?: (action: string) => void;
  /** Current cwd shown by the CwdPicker (the active session's cwd, or the
   *  new-session pick while no session is selected). */
  cwd?: string | null;
  /** Fired when the CwdPicker picks a different cwd (new-session mode, or
   *  switching projects while a session is idle). */
  onCwdChange?: (cwd: string) => void;
  sessionId?: string | null;
  /**
   * Plain-text user messages from the active session, oldest first. Sourced
   * from `useAgentSession.messages` (which reflects the backend .jsonl) so
   * ArrowUp recall matches the real conversation history across refreshes
   * and devices. Used by the input history navigation in handleKeyDown.
   */
  userMessageHistory?: string[];
  /** Publish the tab-local unsent draft state to the session workspace. */
  onDraftChange?: (draft: {
    dirty: boolean;
    text: string;
    imageCount: number;
    cursorPosition: number;
  }) => void;
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
  retryInfo,
  slashResources = [], slashResourceKey,
  onSlashAction,
  cwd,
  onCwdChange,
  sessionId,
  userMessageHistory,
  onDraftChange,
}: Props, ref) {
  const { t, locale } = useI18n();
  const { contextUsage, sessionStats } = useSessionUiState();

  // ── Textarea + caret ──────────────────────────────────────────────────
  const [value, setValue] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Settings-derived typewriter state ─────────────────────────────────
  const { typewriterPhrases, typewriterEffectEnabled, typewriterKey } = useTypewriterPhrases(locale);

  // ── Image attachments (file input ref + URL lifecycle owned by hook) ──
  const {
    attachedImages,
    fileInputRef,
    processImageFiles,
    removeImage,
    clearImages,
    handlePaste,
  } = useImageAttachments();

  // ── Slash-command menu state + keyboard handling ──────────────────────
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

  // ── Tools preset dropdown ─────────────────────────────────────────────
  const {
    toolDropdownOpen,
    customExpanded,
    toolDropdownRef,
    setToolDropdownOpen,
    toggleCustomExpanded,
  } = useToolsDropdown();

  // ── Input history (ArrowUp/Down recall) ───────────────────────────────
  // fillFromHistory needs textareaRef + setValue + setCursorPosition +
  // clearImages, so we implement it here and pass it down as `navigateTo`.
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
  });

  // Keep the draft owned by this input/controller. The workspace only needs a
  // small dirty snapshot for close confirmation; the actual text and images
  // remain here so switching tabs never round-trips them through the server.
  useEffect(() => {
    onDraftChange?.({
      dirty: Boolean(value.trim() || attachedImages.length || selectedSlashResource),
      text: value,
      imageCount: attachedImages.length,
      cursorPosition,
    });
  }, [value, attachedImages.length, selectedSlashResource, cursorPosition, onDraftChange]);

  // ── Build/send message ─────────────────────────────────────────────────
  const buildMessage = useCallback(
    (rawMessage: string) => {
      const msg = rawMessage.trim();
      if (selectedSlashResource) {
        return formatSlashContent(selectedSlashResource, msg, true);
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
    // No need to record locally — `useAgentSession.handleSend` already
    // pushes the message into its `messages` state, which feeds
    // `userMessageHistory` on the next render. Reset the local index so
    // the next ArrowUp starts a fresh recall.
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

  // ── Autoresize on every keystroke ─────────────────────────────────────
  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  // ── Ctrl/Cmd+Enter sends; bare /new / /compact rides the same gate so the
  //    shortcut is consistent across "send a message" and "fire a built-in
  //    slash action". Plain Enter / Shift+Enter fall through to the browser
  //    default (newline), which is what users want when typing multi-line
  //    drafts or in the middle of an IME composition session. ─────────────
  const handleEnterAndBuiltin = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return false;
      if (!(e.ctrlKey || e.metaKey)) return false;
      // Bare built-in slash actions (no trailing args) trigger the action
      // directly, bypassing the prompt-template expansion that prompt/skill
      // commands go through in selectSlashResource.
      const trimmed = value.trim();
      if (trimmed === "/new" || trimmed === "/compact") {
        const action = trimmed.slice(1);
        onSlashAction?.(action);
        setValue("");
        setCursorPosition(0);
        setSelectedSlashResource(null);
        setSlashMenuOpen(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        return true;
      }
      // While the agent is running there is nothing to send to — handleSend
      // no-ops on isStreaming, so Enter just leaves the draft in place.
      e.preventDefault();
      handleSend();
      return true;
    },
    [value, onSlashAction, handleSend, setSelectedSlashResource, setSlashMenuOpen],
  );

  // ── Shift+Backspace clears selected slash resource ─────────────────────
  const handleShiftBackspaceClear = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!(selectedSlashResource && e.shiftKey && e.key === "Backspace")) return false;
      e.preventDefault();
      setSelectedSlashResource(null);
      return true;
    },
    [selectedSlashResource, setSelectedSlashResource],
  );

  // ── Tab / Shift+Tab cycles the thinking level. Hijacked so the textarea
  //    doesn't lose focus mid-conversation; the direction matches the
  //    browser convention (Tab = forward) and mirrors ThinkingPicker's
  //    wheel handler so both affordances agree on the next level. Falls
  //    through to the browser default when the current model advertises
  //    no thinking levels at all (idx === -1 + empty list) so the user can
  //    still tab out of the input in that narrow window. ────────────────
  const handleThinkingTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== "Tab" || e.nativeEvent.isComposing) return false;
      if (!onThinkingLevelChange) return false;
      // Restrict the cycle to levels the active model actually supports —
      // same rule as ThinkingPicker.availableLevels.
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

  // ── Escape closes the slash menu ──────────────────────────────────────
  const handleSlashEscape = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!(slashMenuOpen && e.key === "Escape")) return false;
      e.preventDefault();
      setSlashMenuOpen(false);
      return true;
    },
    [slashMenuOpen, setSlashMenuOpen],
  );

  // ── Master keydown handler: three smaller handlers chained in priority
  //    order. Each returns `true` when it has consumed the event, so the
  //    master handler early-returns without further work. ──────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleShiftBackspaceClear(e)) return;
      if (handleThinkingTabKeyDown(e)) return;
      if (handleSlashKeyDown(e)) return;
      if (handleSlashEscape(e)) return;
      if (handleHistoryKeyDown(e)) return;
      handleEnterAndBuiltin(e);
    },
    [handleShiftBackspaceClear, handleThinkingTabKeyDown, handleSlashKeyDown, handleSlashEscape, handleHistoryKeyDown, handleEnterAndBuiltin],
  );

  // ── Imperative handle for ChatWindow's chatInputRef ───────────────────
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
      // Place cursor at end of current text
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
    },
  }));

  const selectedPromptResource = selectedSlashResource?.source === "prompt" ? selectedSlashResource : null;
  const selectedPromptPreview = useMemo(
    () =>
      selectedPromptResource ? formatSlashContent(selectedPromptResource, value.trim()) : null,
    [selectedPromptResource, value],
  );

  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 8px",
      }}
    >
      {/* Hidden file input */}
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
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* Retry banner */}
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
        {/* Image previews */}
        <AttachmentList images={attachedImages} onRemove={removeImage} />

        {selectedPromptResource && (
          <PromptPreview resource={selectedPromptResource} preview={selectedPromptPreview} />
        )}

        {/* Main input — stays visible while the agent is streaming (abort button handles cancel) */}
        <CollapsiblePanel open={true}>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--bg)",
            border: `1.5px solid ${THINKING_BORDER_COLOR[thinkingLevel ?? "off"]}`,
            borderRadius: 14,
            padding: "10px 10px 10px 14px",
            boxShadow: "none",
            transition: "border-color 0.15s, background 0.15s",
            position: "relative",
          } as React.CSSProperties}
        >
          {!value && !isFocused && typewriterEffectEnabled && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: "50%",
                left: 14,
                transform: "translateY(-50%)",
                pointerEvents: "none",
                color: "var(--text-muted)",
                fontSize: 14,
                lineHeight: 1.6,
                fontWeight: 400,
              }}
            >
              <Typewriter key={typewriterKey} phrases={typewriterPhrases} />
            </span>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              const pos = e.target.selectionStart ?? e.target.value.length;
              setCursorPosition(pos);
              setSlashMenuOpen(Boolean(slashQuery));
              // E2: any user edit exits the history index so the next
              // ArrowUp is treated as a fresh recall, not a continuation.
              if (isInHistoryMode) {
                exitHistoryMode();
              }
            }}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            onSelect={(e) => {
              const pos = e.currentTarget.selectionStart ?? value.length;
              setCursorPosition(pos);
              setSlashMenuOpen(Boolean(slashQuery));
            }}
            onFocus={(e) => {
              const pos = e.currentTarget.selectionStart ?? value.length;
              setCursorPosition(pos);
              setSlashMenuOpen(Boolean(slashQuery));
              setIsFocused(true);
            }}
            onBlur={() => setIsFocused(false)}
            placeholder={
              isFocused
                ? ""
                : !value
                  ? ""
                  : t("Message...")
            }
            rows={1}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
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

          {!isStreaming && (
            <button
              onClick={handleSend}
              disabled={sessionBusy || (!value.trim() && !attachedImages.length && !selectedSlashResource)}
              aria-label={t("Send")}
              style={{
                flexShrink: 0,
                alignSelf: "flex-end",
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, padding: 0,
                background: (value.trim() || attachedImages.length || selectedSlashResource) ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: "50%",
                color: (value.trim() || attachedImages.length || selectedSlashResource) ? "#fff" : "var(--text-dim)",
                cursor: (value.trim() || attachedImages.length || selectedSlashResource) ? "pointer" : "not-allowed",
                boxShadow: (value.trim() || attachedImages.length || selectedSlashResource) ? "0 1px 3px rgba(37,99,235,0.25)" : "none",
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
        {(selectedSlashResource || (slashMenuOpen && slashQuery)) && (
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
          </div>
        )}

        <BottomToolbar
          t={t}
          isStreaming={isStreaming}
          onSlashAction={onSlashAction}
          hasAttachedImages={attachedImages.length > 0}
          fileInputRef={fileInputRef}
          model={model}
          modelNames={modelNames}
          modelIcons={modelIcons}
          modelList={modelList}
          onModelChange={onModelChange}
          cwd={cwd}
          onCwdChange={onCwdChange}
          contextUsage={contextUsage}
          sessionStats={sessionStats}
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
          onAbort={onAbort}
        />
      </div>
    </div>
  );
});