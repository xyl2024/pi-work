import { listProviderCallsByCallIds } from "./llm-audit-db";
import { listMessageCallIds } from "./token-audit-store";
import {
  formatRequestBody,
  requestBodyFileName,
  selectRequestAttempt,
} from "../shared/llm-audit-message-body";

export interface MessageRequestBody {
  fileName: string;
  content: string;
}

export interface MessageRequestBodyParams {
  sessionId: string | null;
  messageId: string | null;
}

export function getMessageRequestBody(
  params: MessageRequestBodyParams,
): MessageRequestBody | null {
  const { sessionId, messageId } = params;
  if (!sessionId || !messageId) return null;

  const callIds = listMessageCallIds(sessionId, messageId);
  if (callIds.length === 0) return null;

  const attempt = selectRequestAttempt(listProviderCallsByCallIds(callIds));
  if (!attempt) return null;

  return {
    fileName: requestBodyFileName(attempt),
    content: formatRequestBody(attempt.requestBody),
  };
}
