/**
 * Thin typed loader for the CodeGraph SDK compiled bundle.
 *
 * `@colbymchenry/codegraph` (npm) is a thin wrapper whose `exports` map only
 * exposes the package root — the actual compiled library (CodeGraph class,
 * ToolHandler, …) lives inside the per-platform bundle package
 * `@colbymchenry/codegraph-<platform>-<arch>/lib/dist/` and is reached via a
 * deep path, exactly like the official `npm-sdk.js` re-export does
 * (`require.resolve(pkg + '/lib/dist/index.js')`). The platform packages have
 * no `exports` field, so deep requires work.
 *
 * WHY `__non_webpack_require__` (and neither a bare `require(...)` nor
 * `createRequire`): webpack statically analyzes both as context requires and
 * scans the whole `@colbymchenry/` directory — the bundle's grammars.js
 * itself uses `require.resolve('tree-sitter-wasms/out/*.wasm')` template
 * strings, so webpack then tries to load every .wasm grammar as a module and
 * fails the build. `__non_webpack_require__` is webpack's escape hatch: the
 * dependency graph never includes the target, and at runtime it maps to the
 * real Node require, so the deep require resolves outside webpack exactly
 * like in plain Node. Outside webpack (dev tooling, smoke tests) it falls
 * back to the ambient `require` (run those as CommonJS, or via an esbuild
 * banner that defines `require`).
 */

import { createRequire } from "node:module";

declare const __non_webpack_require__: NodeRequire | undefined;

const target = `${process.platform}-${process.arch}`;

const TOOL_HANDLER_PATH = `@colbymchenry/codegraph-${target}/lib/dist/mcp/tools.js`;
const INDEX_PATH = `@colbymchenry/codegraph-${target}/lib/dist/index.js`;

/**
 * Resolve the Node `require` needed to reach the compiled bundle's deep
 * path. Loaded lazily (only on first tool call), and the module's own
 * top level never touches `require` — that is what kept webpack builds
 * happy and now keeps Turbopack dev from rejecting the dynamic path.
 *
 * - webpack builds: `__non_webpack_require__` escapes the module graph, so
 *   the bundle's `require.resolve('tree-sitter-wasms/out/*.wasm')` template
 *   strings are never context-scanned (see the history note below).
 * - Turbopack dev: `__non_webpack_require__` is absent and dynamic `require`
 *   is rejected at module evaluation, so we fall back to `createRequire`,
 *   which Turbopack whitelists as a runtime dynamic-loading escape hatch.
 *   `NEXT_RUNTIME` is set under the Next.js server runtime.
 */
function runtimeRequire(): NodeRequire {
  if (typeof __non_webpack_require__ === "function") return __non_webpack_require__;
  if (process.env.TURBOPACK) return createRequire(import.meta.url);
  return require;
}

// ── MCP ToolHandler (read/query tools) ────────────────────────────────

export interface CodeGraphToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface CodeGraphToolHandler {
  execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CodeGraphToolResult>;
  closeAll(): void;
}

export interface CodeGraphSdkModule {
  ToolHandler: new (defaultCodeGraph: unknown) => CodeGraphToolHandler;
}

let cachedSdk: CodeGraphSdkModule | undefined;
/**
 * Lazy accessor for the compiled MCP ToolHandler bundle. Kept off the module
 * top level so neither webpack (context-scan) nor Turbopack (dynamic-require
 * guard) trips over it during module evaluation; it only resolves when a
 * codegraph tool is actually invoked.
 */
export function getSdkModule(): CodeGraphSdkModule {
  if (!cachedSdk) {
    cachedSdk = runtimeRequire()(TOOL_HANDLER_PATH) as CodeGraphSdkModule;
  }
  return cachedSdk;
}

// ── CodeGraph main class (index construction: init/index/sync) ────────

export interface CodeGraphBuildResult {
  // indexAll returns IndexResult (has `success` + tallies + `errors`); sync
  // returns SyncResult which has NO `success` field and reports different
  // counters (filesChecked/filesAdded/filesModified/filesRemoved/nodesUpdated).
  // Keep both shapes here so callers can check `success` presence to tell
  // which one they got; sync never reports failure (it only throws).
  success?: boolean;
  filesIndexed?: number;
  filesSkipped?: number;
  filesErrored?: number;
  filesChecked?: number;
  filesAdded?: number;
  filesModified?: number;
  filesRemoved?: number;
  nodesUpdated?: number;
  errors?: Array<{ message: string; severity?: string }>;
  durationMs: number;
}

export interface CodeGraphMain {
  isInitialized(projectRoot: string): boolean;
  init(projectRoot: string, options?: { index?: boolean }): Promise<CodeGraphInstance>;
  openSync(projectRoot: string): CodeGraphInstance;
}

export interface CodeGraphInstance {
  getProjectRoot(): string;
  indexAll(options?: { onProgress?: (p: unknown) => void }): Promise<CodeGraphBuildResult>;
  sync(options?: unknown): Promise<CodeGraphBuildResult>;
  getStats(): { fileCount: number; nodeCount: number; edgeCount: number } | Record<string, number>;
  close(): void;
  destroy(): void;
}

// The bundle publishes the class both as `default` and as a named export;
// pick whichever is present at runtime.
let cachedMain: CodeGraphMain | undefined;
/**
 * Lazy accessor for the compiled main bundle; see `getSdkModule`.
 */
export function getCodeGraphModule(): CodeGraphMain {
  if (!cachedMain) {
    const mainModule = runtimeRequire()(INDEX_PATH) as CodeGraphMain & {
      default?: CodeGraphMain;
      CodeGraph?: CodeGraphMain;
    };
    cachedMain =
      mainModule.default && typeof mainModule.default.init === "function"
        ? mainModule.default
        : mainModule.CodeGraph && typeof mainModule.CodeGraph.init === "function"
          ? mainModule.CodeGraph
          : mainModule;
  }
  return cachedMain;
}