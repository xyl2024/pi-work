/* Manual smoke test for lib/server/codegraph-tool.ts (SDK-backed tools).
 * Build & run — the banner defines `require` (createRequire) so the SDK
 * loader's fallback path works under ESM:
 *   npx --yes esbuild scripts/test-codegraph-tools.mts --bundle --platform=node \
 *     --format=esm --packages=external \
 *     --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' \
 *     --outfile=lib/server/.cg-smoke.mjs
 *   node lib/server/.cg-smoke.mjs
 */
import { buildCodeGraphTools } from "../lib/server/codegraph-tool.ts";

const cwd = "/home/alone/p/pi-work";
const fakeCtx = { cwd } as never;

const CASES: Record<string, Record<string, unknown>> = {
  codegraph_status: {},
  codegraph_search: { query: "AgentSessionWrapper" },
  codegraph_explore: { query: "AgentSessionWrapper customTools", maxFiles: 2 },
  // Default: no code body (MCP includeCode=false). Separately smoke includeCode.
  codegraph_node: { symbol: "AgentSessionWrapper" },
  codegraph_callers: { symbol: "AgentSessionWrapper" },
  codegraph_callees: { symbol: "AgentSessionWrapper" },
  codegraph_impact: { symbol: "AgentSessionWrapper" },
  codegraph_files: { pattern: "lib/server/*.ts" },
  codegraph_build: { mode: "sync" },
};

async function runOne(name: string, args: Record<string, unknown>, label: string) {
  const tool = buildCodeGraphTools().find((t) => (t as { name: string }).name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  const t0 = Date.now();
  try {
    const res = await (tool as { execute: (id: string, p: unknown, s: undefined, u: undefined, c: never) => Promise<{ content: Array<{ text: string }>; details: unknown }> }).execute(`t-${label}`, args, undefined, undefined, fakeCtx);
    const text = res.content[0]?.text ?? "";
    console.log(`\n=== ${name} [${label}] (${Date.now() - t0}ms) ===`);
    console.log(text.length > 450 ? text.slice(0, 450) + `\n…[${text.length} chars]` : text);
  } catch (err) {
    console.log(`\n=== ${name} [${label}] THREW ===`);
    console.log(err instanceof Error ? err.message : String(err));
  }
}

(async () => {
  for (const [name, args] of Object.entries(CASES)) {
    await runOne(name, args, name);
  }

  // Error path: project without an index → success-shaped guidance
  await runOne("codegraph_search", { query: "foo", path: "/tmp/cg-test" }, "unindexed");
  // Error path: path outside allowed roots → "Error:" text result
  await runOne("codegraph_explore", { query: "x", path: "/nonexistent-root-xyz" }, "bad-path");
  // node with file mode
  await runOne("codegraph_node", { file: "lib/server/rpc-manager.ts" }, "file-mode");
  // node file mode with offset/limit (like Read paging)
  await runOne("codegraph_node", { file: "lib/server/rpc-manager.ts", offset: 1, limit: 5 }, "file-mode-paged");
  // node file mode with symbolsOnly
  await runOne("codegraph_node", { file: "lib/server/rpc-manager.ts", symbolsOnly: true }, "file-mode-symbols");
  // node symbol mode with includeCode: true (verbatim body)
  await runOne("codegraph_node", { symbol: "AgentSessionWrapper", includeCode: true, file: "lib/server/rpc-manager.ts" }, "symbol-incode");
  // build: sync on the live project (fast incremental)
  await runOne("codegraph_build", { mode: "sync" }, "sync-live");
  // build: sync on an un-indexed project → guidance, never auto-init
  await runOne("codegraph_build", { mode: "sync", path: "/tmp/cg-test" }, "sync-unindexed");
  // files with a directory filter (mapped to the SDK's `path` param)
  await runOne("codegraph_files", { filter: "lib/server" }, "filter");
  // build: init on an un-indexed (empty) temp dir → real first build
  const { rmSync, mkdirSync } = await import("node:fs");
  const tmp = "/tmp/cg-build-smoke";
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  await runOne("codegraph_build", { mode: "init", path: tmp }, "init-empty");
  rmSync(tmp, { recursive: true, force: true });
})();