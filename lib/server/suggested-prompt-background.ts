import { createLogger } from "./logger";
import { suggestedPromptQueue } from "./suggested-prompt-queue";
import {
  suggestForSession,
  type SuggestedPromptGenerator,
  type SuggestedPromptOutcome,
} from "./suggested-prompt";

const log = createLogger("suggested-prompt-background");

export interface SuggestedPromptPublication {
  leafId: string;
  suggestion: string;
  generatedAt: number;
}

export interface EnsureSuggestedPromptOptions {
  leafId?: string | null;
  onSuggestion?: (publication: SuggestedPromptPublication) => void;
  generate?: SuggestedPromptGenerator;
  now?: number;
}

export function ensureSuggestionForCurrentLeaf(
  sessionId: string,
  options: EnsureSuggestedPromptOptions = {},
): Promise<SuggestedPromptOutcome | null> {
  return suggestedPromptQueue
    .run(sessionId, () =>
      suggestForSession({
        sessionId,
        leafId: options.leafId,
        generate: options.generate,
        now: options.now,
      }),
    )
    .then((outcome) => {
      if (outcome.kind === "suggestion") {
        try {
          options.onSuggestion?.({
            leafId: outcome.leafId,
            suggestion: outcome.suggestion,
            generatedAt: Date.now(),
          });
        } catch (error) {
          log.warn("suggestion publication failed", { sessionId, error: String(error) });
        }
      }
      return outcome;
    })
    .catch((error) => {
      log.warn("suggestion generation failed", { sessionId, error: String(error) });
      return null;
    });
}
