// ============================================================================
// System prompt template — the impure half (server only)
//
// `lib/shared/system-prompt-template.ts` owns every rendering rule; this module
// owns the *reading*: pulling the live tool list, the tool snippets /
// guidelines, the append block, the project context files, the skills and the
// model out of a pi session and a resource loader, and handing them over as a
// plain `TemplateMaterial`.
//
// Two callers need the same material from two different places:
//
//   - the `before_agent_start` handler in `rpc-manager` gets it from the
//     event's `systemPromptOptions` (that object is the authoritative, live tool
//     loadout for the turn);
//   - `AgentSessionWrapper.renderSystemPrompt()` — the source the Context
//     panel, `get_state` and BTW replay read, including on a session that has
//     never sent a message — collects it from the session + resource loader,
//     because no `before_agent_start` has fired yet.
//
// The normalisations pi applies to snippets and guidelines are copied here too:
// the session path has to produce the same text as the event path, or the panel
// and the model would disagree.
// ============================================================================

import { getDocsPath, getExamplesPath, getReadmePath } from "@earendil-works/pi-coding-agent";
import {
  type TemplateMaterial,
  type TemplateSkill,
} from "../shared/system-prompt-template";

/** The part of `AgentSession` this module reads. Structural on purpose, so
 *  `AgentSessionLike` can satisfy it without an import cycle. */
export interface TemplateSessionLike {
  getActiveToolNames(): string[];
  getToolDefinition?(
    name: string,
  ): { promptSnippet?: string; promptGuidelines?: string[] } | undefined;
  readonly model?: { provider: string; id: string } | undefined;
  readonly thinkingLevel?: string;
}

/** The part of `DefaultResourceLoader` this module reads. */
export interface TemplateResourceLoaderLike {
  getAppendSystemPrompt(): string[];
  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
  getSkills(): { skills: TemplateSkill[] };
}

/** The `systemPromptOptions` shape the event carries, structurally. The four
 *  optional fields after `cwd` are the ones the takeover patches. */
export interface SystemPromptOptionsLike {
  selectedTools?: string[];
  toolSnippets?: Record<string, string>;
  toolGuidelines?: Record<string, string[]>;
  promptGuidelines?: string[];
  appendSystemPrompt?: string;
  contextFiles?: Array<{ path: string; content: string }>;
  skills?: TemplateSkill[];
  cwd?: string;
  customPrompt?: string;
  sections?: Record<string, string>;
}

/** The per-turn extras a session cannot supply by itself. */
export interface TemplateMaterialExtras {
  cwd: string;
  model?: string;
  thinkingLevel?: string;
  date?: string;
}

/** pi's docs paths, from the SDK's top-level exports. */
export function templateDocsPaths(): TemplateMaterial["docsPaths"] {
  return { readme: getReadmePath(), docs: getDocsPath(), examples: getExamplesPath() };
}

/** Today, as `YYYY-MM-DD` in the server's local time zone. */
export function templateDate(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `provider/id`, the label the `model` variable renders. */
export function templateModelLabel(
  model: { provider: string; id: string } | undefined,
): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

/** pi's `_normalizePromptSnippet`: collapse to one trimmed line, or nothing. */
export function normalizePromptSnippet(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const oneLine = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return oneLine.length > 0 ? oneLine : undefined;
}

/** pi's `_normalizePromptGuidelines`: trimmed, de-duplicated, order kept. */
export function normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
  if (!guidelines || guidelines.length === 0) return [];
  const unique = new Set<string>();
  for (const guideline of guidelines) {
    const normalized = guideline.trim();
    if (normalized.length > 0) unique.add(normalized);
  }
  return Array.from(unique);
}

/** Build material from the `before_agent_start` event's options — the turn's
 *  authoritative tool loadout. */
export function materialFromSystemPromptOptions(
  options: SystemPromptOptionsLike,
  extras: TemplateMaterialExtras,
): TemplateMaterial {
  return {
    selectedTools: options.selectedTools ?? [],
    toolSnippets: options.toolSnippets ?? {},
    toolGuidelines: options.toolGuidelines ?? {},
    promptGuidelines: options.promptGuidelines ?? [],
    appendSystemPrompt: options.appendSystemPrompt ?? "",
    contextFiles: options.contextFiles ?? [],
    skills: options.skills ?? [],
    cwd: options.cwd ?? extras.cwd,
    docsPaths: templateDocsPaths(),
    model: extras.model,
    thinkingLevel: extras.thinkingLevel,
    date: extras.date ?? templateDate(),
  };
}

/** Build material from the live session + resource loader. Used for the
 *  panel / `get_state` / BTW source, which must be right before the first
 *  `before_agent_start` has fired. */
export function collectTemplateMaterial(args: {
  session: TemplateSessionLike;
  resourceLoader: TemplateResourceLoaderLike;
  extras: TemplateMaterialExtras;
}): TemplateMaterial {
  const { session, resourceLoader, extras } = args;
  const selectedTools = session.getActiveToolNames();
  const toolSnippets: Record<string, string> = {};
  const toolGuidelines: Record<string, string[]> = {};
  for (const name of selectedTools) {
    const definition = session.getToolDefinition?.(name);
    if (!definition) continue;
    const snippet = normalizePromptSnippet(definition.promptSnippet);
    if (snippet) toolSnippets[name] = snippet;
    const guidelines = normalizePromptGuidelines(definition.promptGuidelines);
    if (guidelines.length > 0) toolGuidelines[name] = guidelines;
  }
  return {
    selectedTools,
    toolSnippets,
    toolGuidelines,
    promptGuidelines: [],
    appendSystemPrompt: resourceLoader.getAppendSystemPrompt().join("\n\n"),
    contextFiles: resourceLoader.getAgentsFiles().agentsFiles,
    skills: resourceLoader.getSkills().skills,
    cwd: extras.cwd,
    docsPaths: templateDocsPaths(),
    model: extras.model ?? templateModelLabel(session.model),
    thinkingLevel: extras.thinkingLevel ?? session.thinkingLevel,
    date: extras.date ?? templateDate(),
  };
}

/** Material for "no session open": docs paths and today's date are real, the
 *  session-derived variables are empty. The settings preview still works, which
 *  is the point — a template can be built before any session exists. */
export function emptyTemplateMaterial(cwd: string): TemplateMaterial {
  return {
    selectedTools: [],
    toolSnippets: {},
    toolGuidelines: {},
    promptGuidelines: [],
    appendSystemPrompt: "",
    contextFiles: [],
    skills: [],
    cwd,
    docsPaths: templateDocsPaths(),
    date: templateDate(),
  };
}
