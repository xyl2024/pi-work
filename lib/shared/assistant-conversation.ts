import { isVisibleChatMessage } from "./chat-timeline";
import type { AgentMessage } from "./types";

export const ASSISTANT_CONVERSATION_PAGE_SIZE = 50;

export interface AssistantConversationSession {
  id: string;
  cwd: string;
  created: string;
  assistant?: boolean;
  messages: readonly AgentMessage[];
}

export interface AssistantConversationPage {
  messages: readonly AgentMessage[];
  start: number;
  hasMore: boolean;
}

export interface AssistantConversationProjection {
  readonly messages: readonly AgentMessage[];
  readonly visibleCount: number;
  readonly pageSize: number;
  readonly latestPageStart: number;
  pageFromEnd(pageIndex: number): AssistantConversationPage;
  pageBefore(start: number): AssistantConversationPage;
}

export interface AssistantConversationOptions {
  defaultCwd: string;
  pageSize?: number;
}

function pageRange(
  messages: readonly AgentMessage[],
  start: number,
  end: number,
): AssistantConversationPage {
  return {
    messages: messages.slice(start, end),
    start,
    hasMore: start > 0,
  };
}

export function projectAssistantConversation(
  sessions: readonly AssistantConversationSession[],
  options: AssistantConversationOptions,
): AssistantConversationProjection {
  const pageSize = Math.max(1, options.pageSize ?? ASSISTANT_CONVERSATION_PAGE_SIZE);
  const ordered = sessions
    .filter((session) => session.assistant === true && session.cwd === options.defaultCwd)
    .slice()
    .sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));

  const messages: AgentMessage[] = [];
  for (const session of ordered) {
    for (const message of session.messages) {
      if (isVisibleChatMessage(message)) messages.push(message);
    }
  }

  const visibleCount = messages.length;
  const latestPageStart = Math.max(0, visibleCount - pageSize);

  return {
    messages,
    visibleCount,
    pageSize,
    latestPageStart,
    pageFromEnd(pageIndex) {
      const index = Math.max(0, Math.trunc(pageIndex));
      const end = Math.max(0, visibleCount - index * pageSize);
      const start = Math.max(0, end - pageSize);
      return pageRange(messages, start, end);
    },
    pageBefore(start) {
      const end = Math.max(0, Math.min(Math.trunc(start), visibleCount));
      const pageStart = Math.max(0, end - pageSize);
      return pageRange(messages, pageStart, end);
    },
  };
}
