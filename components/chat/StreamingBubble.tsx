"use client";

import { memo } from "react";
import type { AgentMessage, ToolResultMessage } from "@/lib/shared/types";
import { MessageView } from "./MessageView";
import { useStreamingMessage } from "@/hooks/useStreamingMessage";

interface Props {
  tabId: string;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: Record<string, string>;
  toolResults?: Map<string, ToolResultMessage>;
  cwd?: string | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
  sessionId?: string | null;
}

function StreamingBubbleInner({ tabId, modelNames, modelIcons, modelIconPreferences, toolResults, cwd, onOpenFile, sessionId }: Props) {
  const { isStreaming, streamingMessage } = useStreamingMessage(tabId);
  if (!isStreaming || !streamingMessage) return null;
  return (
    <div className="streaming-message-item">
      <MessageView
        message={streamingMessage as AgentMessage}
        isStreaming
        toolResults={toolResults}
        modelNames={modelNames}
        modelIcons={modelIcons}
        modelIconPreferences={modelIconPreferences}
        cwd={cwd}
        onOpenFile={onOpenFile}
        sessionId={sessionId}
      />
    </div>
  );
}

export const StreamingBubble = memo(StreamingBubbleInner);
StreamingBubble.displayName = "StreamingBubble";