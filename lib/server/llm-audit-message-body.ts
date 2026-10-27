/**
 * Server-side lookup behind the chat's "download request body" action: which
 * HTTP request body produced this assistant message?
 *
 * Nothing new is captured here — the request bodies already live in
 * `provider_calls` (the LLM API audit log) and the message↔call mapping already
 * lives in `model_calls` (the token-audit log). This module only joins them by
 * call id and hands the decision about *which* attempt to present, how to
 * format it and what to call the file to `lib/shared/llm-audit-message-body.ts`.
 *
 * Server-only: imports both SQLite handles transitively.
 */

import { listProviderCallsByCallIds } from "./llm-audit-db";
import { listMessageCallIds } from "./token-audit-store";
import {
  formatRequestBody,
  requestBodyFileName,
  selectRequestAttempt,
} from "../shared/llm-audit-message-body";

export interface MessageRequestBody {
  /** Suggested download name, e.g. `request-body-deepseek-chat-20240102T030405Z.json`. */
  fileName: string;
  /** Pretty-printed request body, ready to be written to disk. */
  content: string;
}

export interface MessageRequestBodyParams {
  sessionId: string | null;
  messageId: string | null;
}

/**
 * The request body that produced one assistant message, or `null` when it was
 * never captured (audit disabled, retention pruned it, rows written before
 * call ids were recorded, or the call never reached the provider).
 */
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
