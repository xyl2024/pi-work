"use client";

import type { AgentMessage, ToolResultMessage, ReadFileInfo } from "@/lib/shared/types";
import { UserMessageView } from "./message-view/UserMessageView";
import { AssistantMessageView } from "./message-view/AssistantMessageView";
import { CollapseNonceProvider, useCollapseNonce } from "./message-view/context";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  /** Custom-model icon map ("<provider>:<modelId>" → provider id), from /api/models. */
  modelIcons?: Record<string, string>;
  entryId?: string;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  /** Keywords to highlight with <mark> (from in-session search) */
  keywords?: string[];
  /** If this entryId matches, apply a flash animation */
  highlightEntryId?: string | null;
  /** Whether this message contains a search match (for highlight) */
  isSearchMatch?: boolean;
  /** Content rendered between the assistant message body and its footer row */
  afterContent?: React.ReactNode;
  /** Per-turn duration for the LAST assistant message of a turn. */
  turnDuration?: { startMs: number; endMs?: number; running?: boolean };
  /** Files surfaced by this turn's `read` tool calls (footer chips). */
  readFiles?: ReadFileInfo[];
  /** Open a file in the right-hand panel (threaded from AppShell). */
  onOpenFile?: (filePath: string, fileName: string) => void;
}

export function MessageView({ message, isStreaming, toolResults, modelNames, modelIcons, entryId, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, keywords, highlightEntryId, isSearchMatch, afterContent, turnDuration, readFiles, onOpenFile }: Props) {
  const isFocused = !!(highlightEntryId && entryId === highlightEntryId);

  if (message.role === "user") {
    return (
      <div className={isFocused ? "search-flash" : undefined}>
        <UserMessageView message={message} isFocused={isFocused} onNavigate={onNavigate} prevAssistantEntryId={prevAssistantEntryId} onEditContent={onEditContent} keywords={keywords} isSearchMatch={isSearchMatch} />
      </div>
    );
  }
  if (message.role === "assistant") {
    return (
      <div className={isFocused ? "search-flash" : undefined}>
        <AssistantMessageView message={message} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} modelIcons={modelIcons} showTimestamp={showTimestamp} keywords={keywords} isSearchMatch={isSearchMatch} afterContent={afterContent} turnDuration={turnDuration} readFiles={readFiles} onOpenFile={onOpenFile} />
      </div>
    );
  }
  if (message.role === "toolResult") {
    return null;
  }
  return null;
}

export { CollapseNonceProvider, useCollapseNonce };
