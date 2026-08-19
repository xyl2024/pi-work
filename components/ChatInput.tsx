"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent, useMemo } from "react";
import { useI18n, type Locale } from "@/hooks/useI18n";
import { useSettings } from "@/hooks/settingsStore";
import { Tooltip } from "./Tooltip";
import { IconHoverButton } from "./IconHoverButton";
import { ContextUsageBar } from "./ContextUsageBar";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { CwdPicker } from "./CwdPicker";
import { AttachmentList } from "./AttachmentList";
import { SlashCommandHint } from "./SlashCommandHint";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { PromptPreview } from "./PromptPreview";
import { ModelPicker } from "./ModelPicker";
import { ToolsDropdownPanel, READ_ONLY_TOOLS } from "./ToolsDropdownPanel";
import { ThinkingPicker, THINKING_LEVEL_COLOR, type ThinkingLevel } from "./ThinkingPicker";
import { MoreMenu } from "./MoreMenu";
import { Typewriter } from "./Typewriter";
import { DEFAULT_TYPEWRITER_PHRASES } from "@/lib/typewriter-phrases";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import type { ToolInfo, ToolSelection } from "@/lib/types";
import {
  getSlashQuery,
  formatSlashContent,
  findDirectSlashResource,
  type SlashResource,
} from "@/lib/slash-commands";

export type { SlashResource } from "@/lib/slash-commands";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

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

// Border color reflects the active reasoning intensity: gray = off, then a
// cool-to-warm gradient up to red for xhigh. Uses the same level union
// as ThinkingPicker.THINKING_LEVELS so the keys stay in sync.
const THINKING_BORDER_COLOR: Record<ThinkingLevel, string> = {
  off: "rgba(148,163,184,0.55)",   // slate-400
  minimal: "rgba(56,189,248,0.55)", // sky-400
  low: "rgba(59,130,246,0.55)",    // blue-500
  medium: "rgba(139,92,246,0.55)",  // violet-500
  high: "rgba(249,115,22,0.55)",    // orange-500
  xhigh: "rgba(239,68,68,0.55)",    // red-500
  max: "rgba(185,28,28,0.65)",       // red-700
};
const SLASH_PAGE_SIZE = 5;

const BUILTIN_NEW_SESSION: SlashResource = {
  source: "action",
  name: "New session",
  command: "new",
  description: "新建会话",
  path: "",
  content: "",
};

// Built-in `/compact` slash command — triggers the same path as the
// toolbar's `Compact` button (handleCompact in ChatWindow → useAgentSession).
// `source: "action"` skips the prompt-template expansion step in
// selectSlashResource and just invokes `onSlashAction?.("compact")`.
const BUILTIN_COMPACT: SlashResource = {
  source: "action",
  name: "Compact",
  command: "compact",
  description: "压缩当前会话上下文",
  path: "",
  content: "",
};

const BUILTIN_SLASH_ACTIONS: SlashResource[] = [BUILTIN_NEW_SESSION, BUILTIN_COMPACT];

const TYPEWRITER_PHRASES: Record<Locale, string[]> = {
  en: [...DEFAULT_TYPEWRITER_PHRASES.en],
  zh: [...DEFAULT_TYPEWRITER_PHRASES.zh],
};

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
  // Pick the active locale's typewriter phrases from the settings store.
  // Falls back to the bundled defaults whenever the store hasn't loaded
  // yet (initial mount) or the user-supplied list is empty for this
  // locale (parseTypewriterPhrases already guards the empty case, but
  // we belt-and-suspenders here because an empty list would otherwise
  // deadlock the Typewriter effect on `phrases[0] === undefined`).
  const settings = useSettings();
  const typewriterPhrases = useMemo(() => {
    const configured = settings?.typewriter_phrases?.[locale];
    if (Array.isArray(configured) && configured.length > 0) return configured;
    return TYPEWRITER_PHRASES[locale];
  }, [settings, locale]);
  // Master switch for the cycling animated placeholder. Read from the
  // settings store (published from SettingsModal). Defaults to true so
  // the very first render — before /api/settings responds — preserves
  // the pre-toggle behavior. When false the chat input falls back to a
  // plain static "Message..." placeholder.
  const typewriterEffectEnabled = settings?.typewriter_effect?.enabled ?? true;
  // Content-signature key for the Typewriter: changes only when the
  // phrases list's actual content changes (not just the array reference).
  // A remount gives us a clean state reset for any reconfigure — without
  // this, a same-length content edit could leave `text` containing
  // partial chars from the previous phrase. The separator is the
  // start-of-heading control char to avoid collisions with user input.
  // Memoized so the join only recomputes when the phrases ref changes.
  const typewriterKey = useMemo(
    () => `${locale}${typewriterPhrases.join("")}`,
    [typewriterPhrases, locale],
  );
  const [value, setValue] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedSlashResource, setSelectedSlashResource] = useState<SlashResource | null>(null);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashPage, setSlashPage] = useState(0);
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  // Custom row's expand/collapse state. Sticky within the popover's open
  // session — collapsing on every outside click would be annoying since the
  // user frequently toggles a checkbox, clicks outside to close the
  // popover, then re-opens it to confirm. Collapses when the user picks
  // Off/High (those rows auto-close the popover, so this state only
  // persists across open/close cycles within "Custom").
  const [customExpanded, setCustomExpanded] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const attachedImagesRef = useRef<AttachedImage[]>([]);
  attachedImagesRef.current = attachedImages;

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

  // Revoke object URLs when this tab/controller is finally closed. A ref is
  // required so changing the attachment list does not revoke URLs still in use.
  useEffect(() => () => {
    for (const image of attachedImagesRef.current) URL.revokeObjectURL(image.previewUrl);
  }, []);

  // Input history index: `historyIndex` is null when the user is NOT
  // browsing history (regular draft editing). `draftBeforeHistory` is the
  // value the textarea had at the moment the user first pressed ArrowUp;
  // ArrowDown past the newest entry restores it. The actual list of
  // historical messages comes from the `userMessageHistory` prop (sourced
  // from the backend .jsonl via useAgentSession).
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const slashQuery = useMemo(() => getSlashQuery(value, cursorPosition), [value, cursorPosition]);
  const filteredSlashResources = useMemo(() => {
    if (!slashMenuOpen || !slashQuery) return [];
    const q = slashQuery.query.toLowerCase();
    const builtinMatches = BUILTIN_SLASH_ACTIONS.filter((item) =>
      item.command.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q),
    );
    const matches = slashResources.filter((item) => {
      return item.command.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q);
    });
    return builtinMatches.length > 0 ? [...builtinMatches, ...matches] : matches;
  }, [slashMenuOpen, slashQuery, slashResources]);
  const slashPageCount = Math.max(1, Math.ceil(filteredSlashResources.length / SLASH_PAGE_SIZE));
  const slashCurrentPage = Math.min(slashPage, slashPageCount - 1);
  const visibleSlashResources = useMemo(() => {
    const start = slashCurrentPage * SLASH_PAGE_SIZE;
    return filteredSlashResources.slice(start, start + SLASH_PAGE_SIZE);
  }, [filteredSlashResources, slashCurrentPage]);

  useEffect(() => {
    setSelectedSlashResource(null);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    setSlashPage(0);
  }, [slashResourceKey]);

  // Reset the history index when the session changes so the user starts in
  // "regular draft" mode every time they switch sessions — otherwise
  // pressing ArrowUp in a new session could still be inside the previous
  // session's index. The `userMessageHistory` prop is already derived from
  // the current session, so no manual reload is needed.
  useEffect(() => {
    setHistoryIndex(null);
    setDraftBeforeHistory("");
  }, [sessionId]);

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

  const selectedPromptResource = selectedSlashResource?.source === "prompt" ? selectedSlashResource : null;
  const selectedPromptPreview = selectedPromptResource
    ? formatSlashContent(selectedPromptResource, value.trim())
    : null;

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
      processImageFiles(files);
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

  const processImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<AttachedImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // result is "data:<mime>;base64,<data>"
              const base64 = result.split(",")[1];
              resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachedImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, []);

  // Fill the input box with a recalled history entry: replace `value`, drop
  // any attached images (Q8: prevent accidental re-send of last turn's
  // images), and place the caret at the end (Q7).
  const fillFromHistory = useCallback((text: string) => {
    setValue(text);
    setCursorPosition(text.length);
    setAttachedImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const buildMessage = useCallback((rawMessage: string) => {
    const msg = rawMessage.trim();
    if (selectedSlashResource) {
      return formatSlashContent(selectedSlashResource, msg, true);
    }

    const directSlash = findDirectSlashResource(msg, slashResources);
    if (directSlash) {
      return formatSlashContent(directSlash.item, directSlash.args);
    }

    return msg;
  }, [selectedSlashResource, slashResources]);

  const handleSend = useCallback(() => {
    const msg = buildMessage(value);
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onSend(msg, attachedImages.length ? attachedImages : undefined);
    // No need to record locally — `useAgentSession.handleSend` already
    // pushes the message into its `messages` state, which feeds
    // `userMessageHistory` on the next render. Reset the local index so
    // the next ArrowUp starts a fresh recall.
    setHistoryIndex(null);
    setDraftBeforeHistory("");
    setValue("");
    setCursorPosition(0);
    setSelectedSlashResource(null);
    setSlashMenuOpen(false);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, attachedImages, isStreaming, onSend, clearImages, buildMessage]);

  const selectSlashResource = useCallback((item: SlashResource) => {
    if (item.source === "action") {
      onSlashAction?.(item.command);
      setValue("");
      setCursorPosition(0);
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      setSlashPage(0);
      setSelectedSlashResource(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus();
      }
      return;
    }

    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? cursorPosition;
    const query = getSlashQuery(value, cursor);
    const nextValue = query
      ? value.slice(0, query.start) + value.slice(cursor)
      : value;

    setSelectedSlashResource(item);
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    setSlashPage(0);

    requestAnimationFrame(() => {
      const nextCursor = query ? query.start : cursor;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextCursor, nextCursor);
      setCursorPosition(nextCursor);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, [cursorPosition, value, onSlashAction]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (selectedSlashResource && e.shiftKey && e.key === "Backspace") {
        e.preventDefault();
        setSelectedSlashResource(null);
        return;
      }

      if (slashMenuOpen && slashQuery && visibleSlashResources.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex((i) => (i + 1) % visibleSlashResources.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex((i) => (i - 1 + visibleSlashResources.length) % visibleSlashResources.length);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashPage((page) => Math.min(page + 1, slashPageCount - 1));
          setSlashActiveIndex(0);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashPage((page) => Math.max(page - 1, 0));
          setSlashActiveIndex(0);
          return;
        }
        if ((e.key === " " || e.code === "Space") && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          selectSlashResource(visibleSlashResources[slashActiveIndex] ?? visibleSlashResources[0]);
          return;
        }
      }
      if (slashMenuOpen && e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
      // Input history navigation (fish-style: prefix-match on buffer, with
      // a friendly fallback to "show the newest entry" when the buffer does
      // not match any history prefix). Skipped entirely when IME composition
      // is active so the user can still use the arrow keys to pick a CJK
      // candidate. If userMessageHistory is empty, we fall through to the
      // default textarea behaviour (caret moves up/down).
      const history = userMessageHistory ?? [];
      if (!e.nativeEvent.isComposing && history.length > 0) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (historyIndex === null) {
            const buffer = value;
            const needle = buffer.toLowerCase();
            const subset = buffer
              ? history.filter((h) => h.toLowerCase().startsWith(needle))
              : history;
            const pool = subset.length > 0 ? subset : history;
            setDraftBeforeHistory(value);
            setHistoryIndex(0);
            fillFromHistory(pool[pool.length - 1]);
          } else {
            const next = Math.min(historyIndex + 1, history.length - 1);
            if (next !== historyIndex) {
              setHistoryIndex(next);
              fillFromHistory(history[history.length - 1 - next]);
            }
          }
          return;
        }
        if (e.key === "ArrowDown") {
          if (historyIndex === null) return; // not browsing history → caret moves
          e.preventDefault();
          const next = historyIndex - 1;
          if (next < 0) {
            // Past the newest entry → restore the pre-history draft (E1).
            const draft = draftBeforeHistory;
            setHistoryIndex(null);
            setDraftBeforeHistory("");
            fillFromHistory(draft);
          } else {
            setHistoryIndex(next);
            fillFromHistory(history[history.length - 1 - next]);
          }
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
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
          return;
        }
        // While the agent is running there is nothing to send to — handleSend
        // no-ops on isStreaming, so Enter just leaves the draft in place.
        handleSend();
      }
    },
    [handleSend, slashMenuOpen, slashQuery, visibleSlashResources, slashActiveIndex, slashPageCount, selectSlashResource, selectedSlashResource, value, onSlashAction, userMessageHistory, historyIndex, draftBeforeHistory, fillFromHistory]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles]);



  // Current thinking level's display label for the streaming badge —
  // mirrors the same computation inside ThinkingPicker so the user sees
  // the same mapped value the picker button shows.
  const currentThinkingLevel: ThinkingLevel = thinkingLevel ?? "off";
  const currentThinkingMapped = thinkingLevelMap
    ? thinkingLevelMap[currentThinkingLevel]
    : undefined;
  const currentThinkingDisplay = (currentThinkingMapped != null && currentThinkingMapped !== currentThinkingLevel)
    ? currentThinkingMapped
    : currentThinkingLevel;

  // Tools trigger button label. "Tools · Off" when no tools, "Tools · Read only"
  // when the Read-only quick preset is active, "Tools · Custom (N)" when a
  // partial subset is active, plain "Tools" for Full (the default).
  // Drives discoverability: the user can tell at a glance which mode they're
  // in without opening the popover.
  const isReadOnlySelection = Array.isArray(toolSelection)
    && toolSelection.length === READ_ONLY_TOOLS.length
    && toolSelection.every((name) => (READ_ONLY_TOOLS as readonly string[]).includes(name));
  const toolsTriggerLabel = Array.isArray(toolSelection)
    ? toolSelection.length === 0
      ? t("Tools · Off")
      : isReadOnlySelection
        ? t("Tools · Read only")
        : t("Tools · Custom ({count})", { count: toolSelection.length })
    : t("Tools");
  // Local capture: `onToolSelectionChange` is declared optional on Props,
  // but the surrounding `!isStreaming && onToolSelectionChange` guard means
  // it's always defined inside this block. Capturing it as a non-optional
  // local lets TS narrow the type for the inline callbacks below.
  const handleToolSelectionChangeLocal = onToolSelectionChange ?? (() => {});

  // Close dropdowns on outside click. The model picker manages its own
  // outside-click dismissal internally (see ModelPicker).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
          processImageFiles(files);
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
              setCursorPosition(e.target.selectionStart ?? e.target.value.length);
              setSlashMenuOpen(Boolean(getSlashQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)));
              // E2: any user edit exits the history index so the next
              // ArrowUp is treated as a fresh recall, not a continuation.
              if (historyIndex !== null) {
                setHistoryIndex(null);
                setDraftBeforeHistory("");
              }
            }}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            onSelect={(e) => {
              const pos = e.currentTarget.selectionStart ?? value.length;
              setCursorPosition(pos);
              setSlashMenuOpen(Boolean(getSlashQuery(value, pos)));
            }}
            onFocus={(e) => {
              const pos = e.currentTarget.selectionStart ?? value.length;
              setCursorPosition(pos);
              setSlashMenuOpen(Boolean(getSlashQuery(value, pos)));
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

        {/* Bottom bar: left | stats | right */}
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
            <IconHoverButton
              onClick={() => fileInputRef.current?.click()}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              }
              label={t("Upload image")}
              ariaLabel={t("Upload image")}
              variant={attachedImages.length ? "accent" : "default"}
            />
            )}
            {/* Model selector — visible always, disabled during streaming */}
            <ModelPicker
              model={model ?? null}
              modelNames={modelNames}
              modelIcons={modelIcons}
              modelList={modelList}
              onModelChange={onModelChange ?? (() => {})}
              disabled={isStreaming}
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
              <ContextUsageBar contextUsage={contextUsage} sessionStats={sessionStats} />
            </div>
          )}

          {/* RIGHT: thinking + tools preset | More | Stop (streaming) */}
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
            {!isStreaming && onToolSelectionChange && (
              <div ref={toolDropdownRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setToolDropdownOpen((v) => !v)}
                  aria-label={t("Tools")}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "0 10px", height: 32,
                    maxWidth: 220, overflow: "hidden",
                    background: toolDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none", borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (toolDropdownOpen) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = toolDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                    {toolsTriggerLabel}
                  </span>
                </button>
                <ToolsDropdownPanel
                  open={toolDropdownOpen}
                  toolSelection={toolSelection}
                  availableTools={availableTools}
                  toolsLoading={toolsLoading}
                  toolsError={toolsError}
                  customExpanded={customExpanded}
                  onSelectPreset={(preset) => {
                    // Each preset maps to a fixed ToolSelection:
                    //   off       → []           (no tools, system prompt cleared)
                    //   full      → "all"        (sentinel so future tools auto-include)
                    //   read_only → the named subset (backend ignores missing names)
                    const next: ToolSelection =
                      preset === "off" ? []
                      : preset === "full" ? "all"
                      : [...READ_ONLY_TOOLS];
                    handleToolSelectionChangeLocal(next);
                    setToolDropdownOpen(false);
                  }}
                  onToggleTool={handleToolSelectionChangeLocal}
                  onRetryEnsureTools={onEnsureAvailableTools}
                  onToggleCustomExpanded={() => {
                    setCustomExpanded((v) => {
                      const next = !v;
                      // First expansion triggers the catalog fetch. After
                      // that, the in-memory catalog is reused for the rest
                      // of the session — `ensureAvailableTools` is a no-op
                      // when the catalog is non-empty.
                      if (next && onEnsureAvailableTools) {
                        void onEnsureAvailableTools();
                      }
                      return next;
                    });
                  }}
                />
              </div>
            )}
            <MoreMenu />

            {isStreaming && (
              <button
                onClick={onAbort}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 14px",
                  height: 32,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 9,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: "-0.01em",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.16)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
                </svg>
                {t("Stop")}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
});

