import { SessionManager } from "@earendil-works/pi-coding-agent";
import { runTurn, type AcquiredTurnSession, type TurnResult } from "./orchestrate";
import { acquireReusedSession } from "./reuse";
import { getRpcSession, startRpcSession } from "../rpc-manager";
import { resolveSessionPath } from "../session-reader";
import type { ToolSelection } from "../../shared/types";
import type { MessageOrigin } from "../../shared/message-origin";

type RpcSessionSource = "scheduled" | "user" | "subagent";

type RpcThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type RunTurnRpcSpec = Omit<Parameters<typeof runTurn>[0], "source" | "toolNames" | "thinkingLevel"> & {
  source?: RpcSessionSource;
  toolNames?: ToolSelection;
  thinkingLevel?: RpcThinkingLevel;
  origin?: MessageOrigin;
};

export async function runTurnRpcSession(spec: RunTurnRpcSpec): Promise<TurnResult> {
  return await runTurn(
    {
      cwd: spec.cwd,
      prompt: spec.prompt,
      timeoutMs: spec.timeoutMs,
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.thinkingLevel !== undefined ? { thinkingLevel: spec.thinkingLevel } : {}),
      ...(spec.toolNames !== undefined ? { toolNames: spec.toolNames } : {}),
      ...(spec.source ? { source: spec.source } : {}),
      ...(spec.purpose ? { purpose: spec.purpose } : {}),
      ...(spec.origin ? { origin: spec.origin } : {}),
      ...(spec.session ? { session: spec.session } : {}),
      ...(spec.abortSources ? { abortSources: spec.abortSources } : {}),
      ...(spec.confirmStop ? { confirmStop: true } : {}),
      ...(spec.onSession ? { onSession: spec.onSession } : {}),
    },
    async (cwd, toolNames, source, policy) => {
      if (policy.kind === "reuse") {
        return await acquireReusedSession(policy.sessionId, {
          getLiveSession: (sessionId) => {
            const session = getRpcSession(sessionId);
            return session?.isAlive() ? session : undefined;
          },
          findSessionFile: (sessionId) => resolveSessionPath(sessionId),
          readSessionCwd: (sessionFile) => SessionManager.open(sessionFile).getHeader()?.cwd ?? process.cwd(),
          reopenSession: (sessionId, sessionFile, sessionCwd) =>
            startExistingSession(sessionId, sessionFile, sessionCwd, toolNames, source as RpcSessionSource),
        });
      }

      const tempKey = `__turn__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { session, realSessionId } = await startRpcSession(
        tempKey,
        "",
        cwd,
        toolNames,
        source as RpcSessionSource,
      );
      return { session, sessionId: tempKey, realSessionId };
    },
  );
}

async function startExistingSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames: ToolSelection | undefined,
  source: RpcSessionSource,
): Promise<AcquiredTurnSession> {
  const { session, realSessionId } = await startRpcSession(sessionId, sessionFile, cwd, toolNames, source);
  return { session, sessionId, realSessionId };
}
