"use client";

/**
 * Renders the in-flight streaming assistant message. Subscribes to the
 * streaming-message store directly so ChatWindowContent doesn't need to
 * re-render on every token — only this subtree does. Wrapped in
 * React.memo to keep prop changes (modelNames/modelIcons) from
 * triggering re-renders when the message payload alone changed.
 */

import { memo } from "react";
import type { AgentMessage } from "@/lib/shared/types";
import { MessageView } from "./MessageView";
import { useStreamingMessage } from "@/hooks/useStreamingMessage";

interface Props {
  tabId: string;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
}

function StreamingBubbleInner({ tabId, modelNames, modelIcons }: Props) {
  const { isStreaming, streamingMessage } = useStreamingMessage(tabId);
  if (!isStreaming || !streamingMessage) return null;
  return <MessageView message={streamingMessage as AgentMessage} isStreaming modelNames={modelNames} modelIcons={modelIcons} />;
}

export const StreamingBubble = memo(StreamingBubbleInner);
StreamingBubble.displayName = "StreamingBubble";