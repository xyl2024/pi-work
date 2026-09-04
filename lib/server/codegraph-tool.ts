/**
 * Pi Work custom agent tools backed by CodeGraph (https://codegraph.dev —
 * @colbymchenry/codegraph), a local-first semantic code intelligence library.
 *
 * Instead of shelling out to the `codegraph` CLI, the tools call the SDK's
 * MCP `ToolHandler` in-process (see codegraph-sdk.ts for how the compiled
 * bundle is loaded). `ToolHandler` is the exact implementation behind the
 * MCP server — the same tool definitions, the same error classification, the
 * same output an agent would get from the official MCP integration — so no
 * behavior drift between CodeGraph's reference surface and Pi Work:
 *
 *   codegraph_status    — is a project indexed, and index stats
 *   codegraph_search    — FTS symbol search
 *   codegraph_explore   — one-shot exploration: symbol source + call paths
 *   codegraph_node      — single symbol body + caller/callee trail
 *   codegraph_callers   — who calls a symbol
 *   codegraph_callees   — what a symbol calls
 *   codegraph_impact    — blast radius of changing a symbol
 *   codegraph_files     — indexed files with language/symbol counts
 *
 * Connections are pooled by resolved project root inside the long-lived
 * ToolHandler (`projectCache`); an idle-eviction timer calls `closeAll()`
 * after CODE_GRAPH_IDLE_TTL so a quiet Pi Work instance does not pin open
 * SQLite handles forever. ToolHandler's own classification is preserved:
 * NotIndexedError answers as SUCCESS-shaped guidance (the model should fall
 * back to read/grep and not give up on the toolset), PathRefusalError and
 * genuine failures surface as errors.
 */

import path from "node:path";
import { Type } from "typebox";
import { defineTool, type AgentToolResult, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getAllowedRoots, isPathAllowed } from "./file-access";
import { getSdkModule, getCodeGraphModule, type CodeGraphToolHandler, type CodeGraphToolResult, type CodeGraphBuildResult } from "./codegraph-sdk";

/** Idle TTL before the pooled ToolHandler closes all cached project connections. */
const IDLE_TTL_MS = 15 * 60 * 1000;

// ────────────────────────── pooled handler ────────────────────────────
// One ToolHandler per process; its internal projectCache keeps open
// CodeGraph instances by resolved project root. `closeAll()` releases every
// SQLite handle; the next tool call lazily re-creates the handler.
let pooledHandler: CodeGraphToolHandler | null = null;
let lastUsedAt = 0;
let idleTimer: NodeJS.Timeout | null = null;

function getPooledHandler(): CodeGraphToolHandler {
  const now = Date.now();
  if (pooledHandler) {
    lastUsedAt = now;
    return pooledHandler;
  }
  const sdk = getSdkModule();
  pooledHandler = new sdk.ToolHandler(null);
  lastUsedAt = now;
  // Reset the idle timer on every fresh creation.
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pooledHandler && Date.now() - lastUsedAt >= IDLE_TTL_MS) {
      pooledHandler.closeAll();
      pooledHandler = null;
    }
  }, IDLE_TTL_MS);
  idleTimer.unref?.();
  return pooledHandler;
}

// ───────────────────────────── helpers ────────────────────────────────

type ToolResult = AgentToolResult<Record<string, unknown>>;

function textResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text: `Error: ${text}` }], details: {} };
}

/**
 * Resolve a user-supplied project path against the allowed roots, mirroring
 * `/api/files` semantics: absolute paths must sit under a session cwd or a
 * pi-work workspace root; relative paths resolve against the session cwd.
 */
async function resolveProjectPath(
  input: string | undefined,
  cwd: string,
): Promise<{ ok: true; abs: string } | { ok: false; error: string }> {
  const raw = input && input.trim().length > 0 ? input.trim() : cwd;
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd, raw);
  let allowedRoots: Set<string>;
  try {
    allowedRoots = await getAllowedRoots();
  } catch (e) {
    return { ok: false, error: `Failed to check allowed roots: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isPathAllowed(abs, allowedRoots)) {
    return { ok: false, error: `Path not in allowed roots: ${abs}` };
  }
  return { ok: true, abs };
}

/**
 * Run one CodeGraph tool against the pooled handler. Maps the MCP-style
 * result to an AgentToolResult:
 *  - success (or SUCCESS-shaped guidance like NotIndexedError) → text result
 *  - isError (PathRefusalError / genuine malfunction; ToolHandler's text is
 *    already `Error: …`) → throw, so the Pi Work UI marks the call as failed
 *    and the model sees the message, matching "stop trying" semantics.
 */
async function runTool(
  toolName: string,
  args: Record<string, unknown>,
  paramsPath: string | undefined,
  cwd: string,
): Promise<ToolResult> {
  const resolved = await resolveProjectPath(paramsPath, cwd);
  if (!resolved.ok) return errorResult(resolved.error);

  let result: CodeGraphToolResult;
  try {
    result = await getPooledHandler().execute(toolName, { ...args, projectPath: resolved.abs });
  } catch (e) {
    return errorResult(`codegraph ${toolName} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = result.content[0]?.text ?? "";
  if (result.isError) {
    throw new Error(text.startsWith("Error: ") ? text : `Error: ${text}`);
  }
  return textResult(text);
}

// ────────────────────────────── schemas ───────────────────────────────
// Parameter shapes map 1:1 to the official MCP tool schemas
// (src/mcp/tools.ts) so argument handling matches CodeGraph's reference
// surface exactly. `path` is named `path` (not the MCP `projectPath`) for a
// consistent Pi Work UI; it is forwarded as `projectPath`.

const PathParam = Type.Optional(
  Type.String({
    description:
      "Project root to query (the MCP `projectPath`): any directory inside the project works — the nearest `.codegraph/` index at or above it is used. Defaults to the session working directory, and must resolve inside an allowed root (a session cwd or a pi-work workspace).",
  }),
);

const statusParams = Type.Object({ path: PathParam });
const searchParams = Type.Object({
  query: Type.String({ minLength: 1, description: "Symbol name or search text (e.g. `AgentSessionWrapper`, `customTools`)." }),
  path: PathParam,
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10, description: "Maximum results (default 10)." })),
  kind: Type.Optional(
    Type.Union(
      [
        Type.Literal("function"),
        Type.Literal("method"),
        Type.Literal("class"),
        Type.Literal("interface"),
        Type.Literal("type"),
        Type.Literal("variable"),
        Type.Literal("route"),
        Type.Literal("component"),
      ],
      { description: "Filter by node kind (function, method, class, interface, type, variable, route, component)." },
    ),
  ),
});
const exploreParams = Type.Object({
  query: Type.String({
    minLength: 1,
    description:
      "A symbol bag or natural-language description of the area to explore (e.g. `AgentSessionWrapper customTools`, or `how file diff rendering works`). One call returns the relevant symbols' verbatim source grouped by file, with call paths and blast radius.",
  }),
  path: PathParam,
  maxFiles: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 12, description: "Maximum number of files to include source from (default 12)." }),
  ),
});
const nodeParams = Type.Object({
  symbol: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Symbol name (may be qualified, e.g. `AgentSessionWrapper::sessionId`). Symbol mode: returns its location, signature and caller/callee trail; pass `includeCode: true` for the verbatim body. An ambiguous name returns every matching definition in one call. Omit and pass only `file` to read a file like the Read tool.",
    }),
  ),
  includeCode: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Symbol mode: include the symbol's full body (default: false). Ignored in file mode, which always returns source unless `symbolsOnly` is set.",
    }),
  ),
  path: PathParam,
  file: Type.Optional(Type.String({ description: "Read this file instead (path or basename), or disambiguate an overloaded symbol to this file." })),
  offset: Type.Optional(Type.Integer({ minimum: 1, description: "File mode: 1-based line to start reading from (like Read's offset). Defaults to the start of the file." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: "File mode: maximum number of lines to return (like Read's limit). Defaults to the whole file." })),
  symbolsOnly: Type.Optional(
    Type.Boolean({
      default: false,
      description: "File mode: return just the file's symbol map + dependents (a cheap structural overview) instead of its source.",
    }),
  ),
  line: Type.Optional(Type.Integer({ minimum: 1, description: "Symbol mode only: disambiguate to the definition at/around this line (use with the file:line a trail showed you)." })),
});
const symbolParams = Type.Object({
  symbol: Type.String({
    minLength: 1,
    description: "Symbol name. May be qualified with `::`/`.` (e.g. `AgentSessionWrapper::sessionId`). Use a less specific name if the exact one is not found.",
  }),
  path: PathParam,
  file: Type.Optional(Type.String({ description: "Narrow to the definition in this file (path or suffix) when several same-named symbols exist." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20, description: "Maximum results (default 20)." })),
});
const impactParams = Type.Object({
  symbol: Type.String({ minLength: 1, description: "Symbol name whose blast radius to analyze." }),
  path: PathParam,
  file: Type.Optional(Type.String({ description: "Narrow to the definition in this file (path or suffix) when several same-named symbols exist." })),
  depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 2, description: "Traversal depth (default 2)." })),
});
const filesParams = Type.Object({
  path: PathParam,
  filter: Type.Optional(Type.String({ description: "Only files under this directory, project-relative (the MCP `path` filter; e.g. \"src/components\")." })),
  pattern: Type.Optional(Type.String({ description: "Glob pattern, e.g. `lib/**/*.ts`." })),
  format: Type.Optional(Type.String({ enum: ["tree", "flat", "grouped"], default: "tree", description: "Output format." })),
});
const buildParams = Type.Object({
  mode: Type.Optional(
    Type.Union([
      Type.Literal("sync", { description: "Incremental update of an existing index (fast, safe — never blocked)." }),
      Type.Literal("index", { description: "Full re-index of an initialized project (slow; requires user confirmation)." }),
      Type.Literal("init", { description: "Create an index from scratch, first build (very slow; requires user confirmation)." }),
    ], { default: "sync", description: "What to build: sync (default) / index / init." }),
  ),
  path: PathParam,
});

/* ───────────────── system-prompt append block (shared by the family) ──── */

/*
 * Hardcoded, whole-block system-prompt contribution for the codegraph tool
 * family. Appended at the very end of the system prompt via
 * `appendSystemPromptOverride`, gated on the codegraph family being loaded
 * AND at least one family tool being part of the session's tool set (same
 * pattern as `agent_todo`).
 *
 * The family shares ONE block instead of per-tool blocks because its tools
 * are bound together in the UI (TOOL_GROUPS: toggled on/off as a group) and
 * their guidance is only meaningful as a set. Replaces the flat
 * `promptGuidelines` arrays that used to live on the tool definitions.
 */
export const CODEGRAPH_SYSTEM_PROMPT_BLOCK = `\
## CodeGraph toolset guidelines
- Prefer codegraph_* tools over raw read/grep for structural questions once a project is indexed.
- For 'how does X work', 'flow from X to Y', or 'what is affected by editing X' — call \`codegraph_explore\` with the relevant symbol names before reaching for read/grep.
- Treat source returned by \`codegraph_explore\` as already-read; don't re-read the same files separately.
- If the response is insufficient, call it again with more specific symbol names rather than reconstructing the graph by hand.
- If the project is not indexed, create the index with \`codegraph_build\` (mode=init) — the tool pauses for user confirmation before the heavy scan. Until it completes, keep using read/grep/ls.
- sync keeps an already-indexed project fresh after many file changes and is safe to call on your own judgement; init (first build) and index (full rebuild) take minutes, pause for user confirmation, and stop if denied.
`;

/* ─────────────────────────── tool definitions ───────────────────────── */

const statusTool = defineTool<typeof statusParams, Record<string, unknown>>({
  name: "codegraph_status",
  label: "CodeGraph Status",
  description:
    "Index health check: files / nodes / edges / database size / journal mode, plus node-kind and language breakdowns and pending-resolution warnings. Call this to confirm codegraph is available before relying on the other codegraph_* tools.",
  parameters: statusParams,
  promptSnippet: "Check CodeGraph index status for a project.",
  // Guidelines moved to the shared CODEGRAPH_SYSTEM_PROMPT_BLOCK — injected
  // via appendSystemPromptOverride, gated on the codegraph family.
  async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
    return runTool("codegraph_status", {}, params.path, ctx.cwd);
  },
});

const searchTool = defineTool<typeof searchParams, Record<string, unknown>>({
  name: "codegraph_search",
  label: "CodeGraph Search",
  description:
    "Full-text search for indexed symbols (FTS5): returns matching nodes with kind, qualified name, file path, and line numbers. Use to locate a symbol; use `codegraph_explore` when you need source bodies.",
  parameters: searchParams,
  promptSnippet: "Search indexed symbols by name or text.",
  async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
    const args: Record<string, unknown> = { query: params.query };
    if (params.limit !== undefined) args.limit = params.limit;
    if (params.kind !== undefined) args.kind = params.kind;
    return runTool("codegraph_search", args, params.path, ctx.cwd);
  },
});

const exploreTool = defineTool<typeof exploreParams, Record<string, unknown>>({
  name: "codegraph_explore",
  label: "CodeGraph Explore",
  description:
    "One-shot code exploration: given a symbol bag or a description, returns the relevant symbols' verbatim, line-numbered source grouped by file, the call path among them (including dynamic-dispatch hops), and blast radius. THE primary codegraph tool — call it BEFORE read/grep for structural, flow, architecture, or modify-impact questions.",
  parameters: exploreParams,
  promptSnippet: "Explore an area of the codebase: source + call paths in one call.",
  // Guidelines moved to the shared CODEGRAPH_SYSTEM_PROMPT_BLOCK — injected
  // via appendSystemPromptOverride, gated on the codegraph family.
  async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
    const args: Record<string, unknown> = { query: params.query };
    if (params.maxFiles !== undefined) args.maxFiles = params.maxFiles;
    return runTool("codegraph_explore", args, params.path, ctx.cwd);
  },
});

const nodeTool = defineTool<typeof nodeParams, Record<string, unknown>>({
  name: "codegraph_node",
  label: "CodeGraph Node",
  description:
    "Two modes. (1) READ A FILE — pass `file` (path or basename) with no `symbol` and it returns that file's current on-disk source with line numbers (the same shape Read gives you), narrowable with `offset`/`limit`, plus a one-line note of which files depend on it; `symbolsOnly` returns just the file's symbol map instead of the source. (2) ONE SYMBOL — its location, signature and caller/callee trail in one call, so before changing it you see what calls it and what your edit would break; pass `includeCode: true` for the verbatim body. An AMBIGUOUS name returns every matching definition in one call (pass `file`/`line` to pin one). Use codegraph_explore for several related symbols or a full flow.",
  parameters: nodeParams,
  promptSnippet: "Read a single symbol's source with its call trails.",
  async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
    const args: Record<string, unknown> = {};
    if (params.symbol !== undefined) args.symbol = params.symbol;
    if (params.includeCode !== undefined) args.includeCode = params.includeCode;
    if (params.file !== undefined) args.file = params.file;
    if (params.offset !== undefined) args.offset = params.offset;
    if (params.limit !== undefined) args.limit = params.limit;
    if (params.symbolsOnly !== undefined) args.symbolsOnly = params.symbolsOnly;
    if (params.line !== undefined) args.line = params.line;
    return runTool("codegraph_node", args, params.path, ctx.cwd);
  },
});

function buildCalleesTool(name: "codegraph_callers" | "codegraph_callees", label: string, description: string) {
  return defineTool<typeof symbolParams, Record<string, unknown>>({
    name,
    label,
    description,
    parameters: symbolParams,
    promptSnippet: name === "codegraph_callers" ? "Find who calls a symbol." : "Find what a symbol calls.",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
      const args: Record<string, unknown> = { symbol: params.symbol };
      if (params.file !== undefined) args.file = params.file;
      if (params.limit !== undefined) args.limit = params.limit;
      return runTool(name, args, params.path, ctx.cwd);
    },
  });
}

const callersTool = buildCalleesTool(
  "codegraph_callers",
  "CodeGraph Callers",
  "List every function/method that calls the given symbol, with file and line. Use when you need precise call sites for a change.",
);
const calleesTool = buildCalleesTool(
  "codegraph_callees",
  "CodeGraph Callees",
  "List what the given symbol calls (its callees), with file and line. Use to trace a function's dependencies without reading its body.",
);

const impactTool = defineTool<typeof impactParams, Record<string, unknown>>({
  name: "codegraph_impact",
  label: "CodeGraph Impact",
  description:
    "Analyze the blast radius of changing a symbol: every node reachable within a traversal depth plus the connecting edges, with an explanation of how each is affected. Use before editing a symbol to know what to verify.",
  parameters: impactParams,
  promptSnippet: "Analyze what code is affected by changing a symbol.",
  async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
    const args: Record<string, unknown> = { symbol: params.symbol };
    if (params.file !== undefined) args.file = params.file;
    if (params.depth !== undefined) args.depth = params.depth;
    return runTool("codegraph_impact", args, params.path, ctx.cwd);
  },
});

const filesTool = defineTool<typeof filesParams, Record<string, unknown>>({
  name: "codegraph_files",
  label: "CodeGraph Files",
  description:
    "List the files CodeGraph has indexed, with language and symbol counts, as a tree/flat/grouped view. Useful to survey a project's structure or find where a file lives.",
  parameters: filesParams,
  promptSnippet: "List indexed files with language and symbol counts.",
  async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
    const args: Record<string, unknown> = {};
    // The SDK's handleFiles reads the directory filter from `args.path` (its
    // `path` param). Pi Work names it `filter` for a consistent UI, so map it
    // back — `path` here is the project root and travels as `projectPath`.
    if (params.filter !== undefined) args.path = params.filter;
    if (params.pattern !== undefined) args.pattern = params.pattern;
    if (params.format !== undefined) args.format = params.format;
    return runTool("codegraph_files", args, params.path, ctx.cwd);
  },
});

/**
 * Format a build result (CodeGraphBuildResult) into a model-facing summary.
 *
 * The SDK returns two different shapes: indexAll → IndexResult (has `success` +
 * indexed/skipped/errored tallies + `errors`), sync → SyncResult which has NO
 * `success` field and reports checked/added/modified/removed/nodesUpdated
 * instead. sync never signals failure in-band — it either throws or succeeds —
 * so a missing `success` must NOT be read as FAILED.
 */
function summarizeBuild(mode: string, abs: string, result: CodeGraphBuildResult): string {
  const isSync = typeof result.filesChecked === "number";
  const succeeded = result.success === true || (isSync && (result.filesErrored ?? 0) === 0);
  const head = succeeded ? `CodeGraph ${mode} complete for ${abs}.` : `CodeGraph ${mode} FAILED for ${abs}.`;
  const lines = [`${head} (${(result.durationMs / 1000).toFixed(1)}s)`];
  if (isSync) {
    if (typeof result.filesChecked === "number" && result.filesChecked > 0) lines.push(`- files checked: ${result.filesChecked}`);
    if (typeof result.filesAdded === "number" && result.filesAdded > 0) lines.push(`- files added: ${result.filesAdded}`);
    if (typeof result.filesModified === "number" && result.filesModified > 0) lines.push(`- files modified: ${result.filesModified}`);
    if (typeof result.filesRemoved === "number" && result.filesRemoved > 0) lines.push(`- files removed: ${result.filesRemoved}`);
    if (typeof result.nodesUpdated === "number" && result.nodesUpdated > 0) lines.push(`- nodes updated: ${result.nodesUpdated}`);
  } else {
    if (typeof result.filesIndexed === "number" && result.filesIndexed > 0) lines.push(`- files indexed: ${result.filesIndexed}`);
    if (typeof result.filesSkipped === "number" && result.filesSkipped > 0) lines.push(`- files skipped: ${result.filesSkipped}`);
    if (typeof result.filesErrored === "number" && result.filesErrored > 0) lines.push(`- files errored: ${result.filesErrored}`);
  }
  const errors = (result.errors ?? []).filter((e) => e && typeof e.message === "string");
  if (errors.length > 0) {
    lines.push("- errors:");
    for (const e of errors.slice(0, 5)) lines.push(`  - ${e.message}`);
  }
  if (!succeeded) {
    lines.push("\nThe index may be incomplete or failing; check the errors above.");
  }
  return lines.join("\n");
}

const buildTool = defineTool<typeof buildParams, Record<string, unknown>>({
  name: "codegraph_build",
  label: "CodeGraph Build",
  description:
    "Build or update the CodeGraph index for a project (mode=sync incremental / index full rebuild / init first build). The index is what the other codegraph_* tools query. sync is fast and safe; index/init take minutes and BLOCK on user confirmation.",
  parameters: buildParams,
  promptSnippet: "Build or update the CodeGraph index (sync / index / init).",
  // Guidelines moved to the shared CODEGRAPH_SYSTEM_PROMPT_BLOCK — injected
  // via appendSystemPromptOverride, gated on the codegraph family.
  async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
    const mode = params.mode ?? "sync";
    const resolved = await resolveProjectPath(params.path, ctx.cwd);
    if (!resolved.ok) return errorResult(resolved.error);

    if (mode === "init") {
      if (getCodeGraphModule().isInitialized(resolved.abs)) {
        return textResult(
          `CodeGraph is already initialized for ${resolved.abs}. Use mode=sync for an incremental update, or mode=index to rebuild from scratch.`,
        );
      }
      try {
        const cg = await getCodeGraphModule().init(resolved.abs, { index: true });
        const stats = cg.getStats();
        cg.close();
        return textResult(
          `CodeGraph index created for ${resolved.abs}.\n` +
            (stats && typeof stats.fileCount === "number" ? `- files: ${stats.fileCount}\n` : "") +
            (stats && typeof stats.nodeCount === "number" ? `- symbols: ${stats.nodeCount}\n` : "") +
            `- ${mode} mode ignores the per-file breakdown (init combines scan+index in one pass).`,
        );
      } catch (e) {
        return errorResult(`codegraph init failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!getCodeGraphModule().isInitialized(resolved.abs)) {
      return textResult(
        `CodeGraph is not initialized for ${resolved.abs} (no .codegraph/ index). ` +
          `Build it with codegraph_build (mode=init) — the tool pauses for user confirmation before the heavy scan. ` +
          `Until it completes, fall back to your usual tools (read/grep/ls).`,
      );
    }

    try {
      const cg = getCodeGraphModule().openSync(resolved.abs);
      let result: CodeGraphBuildResult;
      try {
        if (mode === "index") {
          result = await cg.indexAll({});
        } else {
          result = await cg.sync({});
        }
        const stats = cg.getStats();
        const summary = summarizeBuild(mode, resolved.abs, result);
        if (stats && typeof stats.fileCount === "number" && typeof stats.nodeCount === "number") {
          return textResult(`${summary}\n\nIndex now: ${stats.fileCount} files, ${stats.nodeCount} symbols.`);
        }
        return textResult(summary);
      } finally {
        cg.close();
      }
    } catch (e) {
      return errorResult(`codegraph ${mode} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});

/**
 * All codegraph tools, ready to spread into `createAgentSession.customTools`.
 * The generic cast mirrors `createPiWorkBashTool` — the SDK's ToolDefinition
 * is invariant in its render types but `customTools` accepts a heterogeneous
 * list.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCodeGraphTools(): ToolDefinition<any, any, any>[] {
  return [statusTool, searchTool, exploreTool, nodeTool, callersTool, calleesTool, impactTool, filesTool, buildTool];
}