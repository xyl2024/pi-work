"use client";

import { memo, useMemo } from "react";
import type { AgentMessage, ToolResultMessage, ReadFileInfo } from "@/lib/shared/types";
import type { ToolDiffStats } from "@/lib/shared/tool-diff-stats";
import { UserMessageView } from "./message-view/UserMessageView";
import { AssistantMessageView } from "./message-view/AssistantMessageView";
import { CollapseNonceProvider, FileLinkProvider } from "./message-view/context";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: Record<string, string>;
  entryId?: string;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  keywords?: string[];
  highlightEntryId?: string | null;
  isSearchMatch?: boolean;
  afterContent?: React.ReactNode;
  turnDuration?: { startMs: number; endMs?: number; running?: boolean };
  readFiles?: ReadFileInfo[];
  turnDiffStats?: ToolDiffStats | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
  cwd?: string | null;
  sessionId?: string | null;
}

function MessageViewInner({ message, isStreaming, toolResults, modelNames, modelIcons, modelIconPreferences, entryId, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, keywords, highlightEntryId, isSearchMatch, afterContent, turnDuration, readFiles, turnDiffStats, onOpenFile, cwd, sessionId }: Props) {
  const isFocused = !!(highlightEntryId && entryId === highlightEntryId);
  const fileLinkHandler = useMemo(
    () => (onOpenFile ? { openFile: onOpenFile, cwd } : null),
    [onOpenFile, cwd],
  );

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
        <FileLinkProvider value={fileLinkHandler}>
          <AssistantMessageView message={message} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} modelIcons={modelIcons} modelIconPreferences={modelIconPreferences} showTimestamp={showTimestamp} keywords={keywords} isSearchMatch={isSearchMatch} afterContent={afterContent} turnDuration={turnDuration} readFiles={readFiles} turnDiffStats={turnDiffStats} onOpenFile={onOpenFile} cwd={cwd} sessionId={sessionId} />
        </FileLinkProvider>
      </div>
    );
  }
  if (message.role === "toolResult") {
    return null;
  }
  return null;
}

export const MessageView = memo(MessageViewInner);
MessageView.displayName = "MessageView";

export { CollapseNonceProvider };
