"use client";

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { useImageLightbox } from "@/hooks/useImageLightbox";
import { CollapsiblePanel } from "../../ui/CollapsiblePanel";
import { SlashCommandMenu } from "../SlashCommandMenu";
import { findDirectSlashResource, formatSlashContent, rankSlashResources, type SlashResource } from "@/lib/shared/slash-commands";
import { getSlashQuery } from "@/lib/shared/composer-queries";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import { useToolsDropdown } from "../chat-input/hooks/useToolsDropdown";
import { BottomToolbar } from "../chat-input/BottomToolbar";
import { BUILTIN_SLASH_ACTIONS, SLASH_PAGE_SIZE, THINKING_BORDER_COLOR } from "../chat-input/constants";
import { FULL_ACCESS_BORDER_COLOR } from "../../ui/permission-mode-colors";
import type { PermissionMode } from "@/lib/shared/permission-mode";
import type { ThinkingLevelOption } from "@/lib/shared/thinking-level-utils";
import type { AttachedImage } from "../chat-input/types";
import type { ComposerDoc, ComposerHandle, ComposerImageNode, ComposerState } from "@/lib/client/composer/types";
import {
  commitSnapshot,
  emptyComposerState,
  insertNodes,
  insertText as insertTextInState,
  moveToOffset,
  normalizeDoc,
  offsetOfCursor,
  removeImage,
  setCursor,
} from "@/lib/client/composer/model";
import { docLength, offsetToCursor, projectDocText } from "@/lib/client/composer/offsets";
import { reduceComposerKey } from "@/lib/client/composer/reducer";
import { serializeComposer } from "@/lib/client/composer/serialize";
import { applySlashSelection, shouldOpenSlashMenu } from "@/lib/client/composer/slash";
import {
  createImageNode,
  isImageFile,
  nextImageId,
  toAttachedImage,
} from "@/lib/client/composer/images";
import {
  readDoc,
  readSelection,
  restoreCursor,
  writeDoc,
  type ComposerLabels,
} from "@/lib/client/composer/dom";

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
  onSlashAction?: (action: string) => void;
  cwd?: string | null;
  onCwdChange?: (cwd: string) => void;
  onDraftChange?: (draft: {
    dirty: boolean;
    text: string;
    imageCount: number;
    cursorPosition: number;
  }) => void;
  disabled?: boolean;
  showNotifyPicker?: boolean;
  notifyChannelId?: string | null;
  onNotifyChannelChange?: (channelId: string | null) => void;
}

const EDITABLE_STYLE = {
  flex: 1,
  background: "none",
  border: "none",
  outline: "none",
  color: "var(--text)",
  fontSize: 14,
  lineHeight: 1.6,
  fontFamily: "inherit",
  minHeight: 24,
  maxHeight: 200,
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fieldSizing: "content",
} as React.CSSProperties;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({
  onSend, onAbort, isStreaming, sessionBusy = false, model, modelNames, modelIcons, modelIconPreferences, modelList, onModelChange,
  toolSelection = "all", onToolSelectionChange,
  availableTools = [], toolsLoading = false, toolsError = null, onEnsureAvailableTools,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  permissionMode = "confirm", onPermissionModeToggle,
  retryInfo,
  slashResources = [],
  onSlashAction,
  cwd,
  onCwdChange,
  onDraftChange,
  disabled = false,
  showNotifyPicker = false,
  notifyChannelId = null,
  onNotifyChannelChange,
}: Props, ref) {
  const { t } = useI18n();
  const { contextUsage, sessionStats, contextComposition } = useSessionUiState();

  const [state, setState] = useState<ComposerState>(emptyComposerState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashPage, setSlashPage] = useState(0);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageUrlsRef = useRef<Set<string>>(new Set());
  const composingRef = useRef(false);
  const skipProjectionRef = useRef(false);
  const skipNextInputRef = useRef(false);

  const { toolDropdownOpen, customExpanded, toolDropdownRef, setToolDropdownOpen, toggleCustomExpanded } = useToolsDropdown();

  const labels = useMemo<ComposerLabels>(() => ({
    skill: (node) => t("Skill {name}", { name: node.name }),
    skillTitle: (node) => (node.source === "skill" ? t("Skill") : t("Builtin action")),
    file: (path) => t("File {path}", { path }),
    image: (id) => t("Image {id}", { id }),
    removeImage: (id) => t("Remove image {id}", { id }),
  }), [t]);

  const images = useMemo(
    () => state.doc.nodes.filter((node): node is ComposerImageNode => node.kind === "image"),
    [state.doc],
  );

  const imageItems = useMemo(
    () => images.map((node) => ({ alt: t("Image {id}", { id: node.id }), src: node.previewUrl })),
    [images, t],
  );

  const { openAt, lightbox } = useImageLightbox(imageItems);

  useEffect(() => {
    const live = new Set<string>();
    const collect = (doc: ComposerDoc) => {
      for (const node of doc.nodes) {
        if (node.kind === "image") live.add(node.previewUrl);
      }
    };
    for (const snapshot of state.past) collect(snapshot.doc);
    collect(state.doc);
    for (const snapshot of state.future) collect(snapshot.doc);
    for (const url of Array.from(imageUrlsRef.current)) {
      if (live.has(url)) continue;
      URL.revokeObjectURL(url);
      imageUrlsRef.current.delete(url);
    }
  }, [state]);

  useEffect(() => {
    const urls = imageUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (skipProjectionRef.current) {
      skipProjectionRef.current = false;
      return;
    }
    writeDoc(editor, state.doc, labels);
    restoreCursor(editor, state.cursor, state.doc);
  }, [state, labels]);

  const updateState = useCallback((next: ComposerState, options?: { skipProjection?: boolean }) => {
    if (next === stateRef.current) return;
    stateRef.current = next;
    if (options?.skipProjection) skipProjectionRef.current = true;
    setState(next);
    setSlashMenuOpen((open) => shouldOpenSlashMenu(projectDocText(next.doc), offsetOfCursor(next), open));
  }, []);

  const syncFromDom = useCallback((options?: { resetCompositionSkip?: boolean }) => {
    const editor = editorRef.current;
    if (!editor) return;
    const doc = normalizeDoc(readDoc(editor));
    const selection = readSelection(editor);
    const offset = selection ? selection.end : offsetOfCursor(stateRef.current);
    const next = commitSnapshot(stateRef.current, { doc, cursor: offsetToCursor(doc, offset) });
    if (options?.resetCompositionSkip) skipNextInputRef.current = true;
    updateState(next, { skipProjection: true });
  }, [updateState]);

  const focusEditor = useCallback((doc: ComposerDoc, cursor: ComposerState["cursor"]) => {
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      restoreCursor(editor, cursor, doc);
    });
  }, []);

  const resetDoc = useCallback(() => {
    const next = emptyComposerState();
    updateState(next);
    setSlashMenuOpen(false);
    focusEditor(next.doc, next.cursor);
  }, [focusEditor, updateState]);

  const slashQuery = useMemo(
    () => getSlashQuery(projectDocText(state.doc), offsetOfCursor(state)),
    [state],
  );

  const filteredSlashResources = useMemo(() => {
    if (!slashMenuOpen || !slashQuery) return [];
    const query = slashQuery.query.toLowerCase();
    const builtinMatches = rankSlashResources(BUILTIN_SLASH_ACTIONS, query);
    const matches = rankSlashResources(slashResources, query);
    return builtinMatches.length > 0 ? [...builtinMatches, ...matches] : matches;
  }, [slashMenuOpen, slashQuery, slashResources]);

  const slashPageCount = Math.max(1, Math.ceil(filteredSlashResources.length / SLASH_PAGE_SIZE));
  const slashCurrentPage = Math.min(slashPage, slashPageCount - 1);
  const visibleSlashResources = useMemo(() => {
    const start = slashCurrentPage * SLASH_PAGE_SIZE;
    return filteredSlashResources.slice(start, start + SLASH_PAGE_SIZE);
  }, [filteredSlashResources, slashCurrentPage]);

  useEffect(() => {
    setSlashActiveIndex(0);
    setSlashPage(0);
  }, [slashQuery?.query, slashResources]);

  useEffect(() => {
    setSlashPage((page) => Math.min(page, slashPageCount - 1));
  }, [slashPageCount]);

  useEffect(() => {
    setSlashActiveIndex((index) => Math.min(index, Math.max(0, visibleSlashResources.length - 1)));
  }, [visibleSlashResources.length]);

  const selectSlashResource = useCallback((item: SlashResource) => {
    const current = stateRef.current;
    const cursorOffset = offsetOfCursor(current);
    if (item.source === "action") onSlashAction?.(item.command);
    const next = applySlashSelection(current, item, cursorOffset);
    updateState(next);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    setSlashPage(0);
    focusEditor(next.doc, next.cursor);
  }, [focusEditor, onSlashAction, updateState]);

  const handleSlashKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): boolean => {
    if (!slashMenuOpen) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setSlashMenuOpen(false);
      return true;
    }
    if (!slashQuery || visibleSlashResources.length === 0) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashActiveIndex((index) => (index + 1) % visibleSlashResources.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashActiveIndex((index) => (index - 1 + visibleSlashResources.length) % visibleSlashResources.length);
      return true;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSlashPage((page) => (page >= slashPageCount - 1 ? 0 : page + 1));
      setSlashActiveIndex(0);
      return true;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSlashPage((page) => (page <= 0 ? slashPageCount - 1 : page - 1));
      setSlashActiveIndex(0);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      selectSlashResource(visibleSlashResources[slashActiveIndex] ?? visibleSlashResources[0]);
      return true;
    }
    return false;
  }, [slashMenuOpen, slashQuery, visibleSlashResources, slashActiveIndex, slashPageCount, selectSlashResource]);

  const addImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) return;
    const nodes = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<ComposerImageNode | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const previewUrl = URL.createObjectURL(file);
              const node = createImageNode({
                id: nextImageId(),
                dataUrl: String(reader.result ?? ""),
                previewUrl,
              });
              if (!node) URL.revokeObjectURL(previewUrl);
              resolve(node);
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );
    const valid = nodes.filter((node): node is ComposerImageNode => node !== null);
    if (valid.length === 0) return;
    for (const node of valid) imageUrlsRef.current.add(node.previewUrl);
    const next = insertNodes(stateRef.current, valid);
    updateState(next);
    focusEditor(next.doc, next.cursor);
  }, [focusEditor, updateState]);

  const removeImageById = useCallback((id: string) => {
    updateState(removeImage(stateRef.current, id));
  }, [updateState]);

  const handleSend = useCallback(() => {
    const current = stateRef.current;
    const serialized = serializeComposer(current.doc);
    const raw = serialized.text;
    const trimmed = raw.trim();
    if (isStreaming) return;
    if (!trimmed && serialized.images.length === 0) return;

    if (trimmed === "/new" || trimmed === "/compact" || trimmed === "/model") {
      onSlashAction?.(trimmed.slice(1));
      resetDoc();
      return;
    }

    const directSlash = findDirectSlashResource(trimmed, slashResources);
    const message = directSlash ? formatSlashContent(directSlash.item, directSlash.args) : trimmed;
    onSend(message, serialized.images.length ? serialized.images.map(toAttachedImage) : undefined);
    resetDoc();
  }, [isStreaming, onSend, onSlashAction, resetDoc, slashResources]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing) return;
    if (handleSlashKeyDown(event)) return;
    const editor = editorRef.current;
    if (!editor) return;
    const selection = readSelection(editor) ?? undefined;
    const result = reduceComposerKey(stateRef.current, {
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      selection,
    });
    if (result.effect === "none") return;
    event.preventDefault();
    if (result.effect === "send") {
      handleSend();
      return;
    }
    updateState(result.state);
  }, [handleSend, handleSlashKeyDown, updateState]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    if (skipNextInputRef.current) {
      skipNextInputRef.current = false;
      return;
    }
    syncFromDom();
  }, [syncFromDom]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    syncFromDom({ resetCompositionSkip: true });
  }, [syncFromDom]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const data = event.clipboardData;
    if (!data) return;
    const editor = editorRef.current;
    const selection = editor ? readSelection(editor) ?? undefined : undefined;
    const text = data.getData("text/plain");
    if (text) {
      const next = insertTextInState(stateRef.current, text, selection);
      updateState(next);
      const target = next.cursor;
      requestAnimationFrame(() => {
        const element = editorRef.current;
        if (!element) return;
        element.focus();
        restoreCursor(element, target, next.doc);
      });
    }
    const files = Array.from(data.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length) void addImageFiles(files);
  }, [addImageFiles, updateState]);

  const handleSelect = useCallback(() => {
    if (composingRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const selection = readSelection(editor);
    if (!selection) return;
    const next = setCursor(stateRef.current, offsetToCursor(stateRef.current.doc, selection.end));
    updateState(next, { skipProjection: true });
  }, [updateState]);

  const chipFromEvent = useCallback((event: React.MouseEvent<HTMLDivElement>): HTMLElement | null => {
    const editor = editorRef.current;
    if (!editor || !(event.target instanceof Element)) return null;
    const chip = event.target.closest("[data-composer-kind]");
    if (!(chip instanceof HTMLElement) || !editor.contains(chip)) return null;
    return chip;
  }, []);

  const handleChipMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-composer-remove]")) {
      event.preventDefault();
      return;
    }
    const chip = chipFromEvent(event);
    const editor = editorRef.current;
    if (!chip || !editor) return;
    event.preventDefault();
    editor.focus();
    const range = document.createRange();
    range.setStartAfter(chip);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    handleSelect();
  }, [chipFromEvent, handleSelect]);

  const handleEditorClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const removeButton = target.closest("[data-composer-remove]");
    if (removeButton) {
      event.preventDefault();
      removeImageById(removeButton.getAttribute("data-composer-remove") ?? "");
      return;
    }
    const chip = target.closest("[data-composer-kind='image']");
    if (!chip) return;
    event.preventDefault();
    const src = chip.getAttribute("data-preview-url");
    if (src) openAt(src);
  }, [openAt, removeImageById]);

  const handleChipDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const chip = chipFromEvent(event);
    if (!chip) return;
    event.preventDefault();
    const range = document.createRange();
    range.selectNode(chip);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    handleSelect();
  }, [chipFromEvent, handleSelect]);

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      const current = stateRef.current;
      const offset = offsetOfCursor(current);
      const before = projectDocText(current.doc).slice(0, offset);
      const separator = before.length > 0 && !/\s$/.test(before) ? " " : "";
      const next = insertTextInState(current, `${separator}${text}`, { start: offset, end: offset });
      updateState(next);
      focusEditor(next.doc, next.cursor);
    },
    insertIfEmpty(content: string) {
      const current = stateRef.current;
      if (serializeComposer(current.doc).text.trim()) return;
      const next = insertTextInState(emptyComposerState(), content);
      updateState(next);
      focusEditor(next.doc, next.cursor);
    },
    addImages(files: File[]) {
      void addImageFiles(files);
    },
    focus() {
      const next = moveToOffset(stateRef.current, docLength(stateRef.current.doc));
      updateState(next);
      focusEditor(next.doc, next.cursor);
    },
  }), [addImageFiles, focusEditor, updateState]);

  useEffect(() => {
    const serialized = serializeComposer(state.doc);
    onDraftChange?.({
      dirty: Boolean(serialized.text.trim() || serialized.images.length),
      text: serialized.text,
      imageCount: serialized.images.length,
      cursorPosition: offsetOfCursor(state),
    });
  }, [state, onDraftChange]);

  const canSend = !disabled && !sessionBusy && (Boolean(serializeComposer(state.doc).text.trim()) || images.length > 0);

  return (
    <div style={{ flexShrink: 0, background: "transparent", padding: "0 16px 8px" }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          void addImageFiles(files);
          event.target.value = "";
        }}
      />
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
        <div style={{ position: "relative" }}>
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
            }}
          >
            <div
              ref={editorRef}
              className="composer-editable"
              contentEditable={!disabled}
              role="textbox"
              aria-multiline="true"
              aria-disabled={disabled}
              data-placeholder={t("Type / for skills, @ for files")}
              data-hide-v-scrollbar
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              onPaste={handlePaste}
              onClick={handleEditorClick}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onSelect={handleSelect}
              onMouseDown={handleChipMouseDown}
              onDoubleClick={handleChipDoubleClick}
              onDrop={(event) => event.preventDefault()}
              style={EDITABLE_STYLE}
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
                onMouseEnter={(event) => { if (!disabled) event.currentTarget.style.background = "#dc2626"; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "#ef4444"; }}
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

        <BottomToolbar
          t={t}
          isStreaming={isStreaming}
          onSlashAction={onSlashAction}
          hasAttachedImages={images.length > 0}
          fileInputRef={fileInputRef}
          model={model}
          modelNames={modelNames}
          modelIcons={modelIcons}
          modelIconPreferences={modelIconPreferences}
          modelList={modelList}
          onModelChange={onModelChange}
          cwd={cwd}
          onCwdChange={onCwdChange ?? (() => {})}
          contextUsage={contextUsage}
          sessionStats={sessionStats}
          contextComposition={contextComposition}
          permissionMode={permissionMode}
          onPermissionModeToggle={onPermissionModeToggle}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={onThinkingLevelChange}
          availableThinkingLevels={availableThinkingLevels as ThinkingLevelOption[] | null | undefined}
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
      </div>
      {lightbox}
    </div>
  );
});
