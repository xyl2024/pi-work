/**
 * Template rendering for workflow node prompts.
 *
 * Each node runs a cold-started agent session, so data must travel between
 * steps through explicit injection. Supported tokens:
 *
 *   {{steps.<nodeId>.reply}}     reply text of a completed node run
 *   {{trigger.input.<key>}}      an input value from the trigger (manual run)
 *   {{env.<NAME>}}               a process environment variable
 *
 * Unknown tokens render as `{{token}}` untouched so a literal template with a
 * stray `{{` doesn't silently vanish.
 */

export interface RenderContext {
  /** nodeId → reply text (only completed/successful nodes). */
  steps: Record<string, string>;
  /** Manual trigger inputs. */
  triggerInput: Record<string, string>;
}

export function renderPrompt(template: string, ctx: RenderContext): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, raw: string) => {
    const token = raw.trim();
    const parts = token.split(".");
    if (parts[0] === "steps" && parts.length >= 3) {
      const nodeId = parts[1];
      const rest = parts.slice(2).join(".");
      const reply = ctx.steps[nodeId];
      if (reply !== undefined) {
        if (rest === "reply") return reply;
        if (rest === "json") {
          // Ask for the step's reply embedded in a JSON string; fall back to
          // the raw reply (best-effort — agent output is not guaranteed JSON).
          try {
            return JSON.stringify(reply);
          } catch {
            return reply;
          }
        }
      }
      return match;
    }
    if (parts[0] === "trigger" && parts[1] === "input" && parts.length >= 3) {
      const key = parts.slice(2).join(".");
      const value = ctx.triggerInput[key];
      return value !== undefined ? value : match;
    }
    if (parts[0] === "env" && parts.length === 2) {
      const value = process.env[parts[1]];
      return value !== undefined && value !== null ? value : match;
    }
    return match;
  });
}