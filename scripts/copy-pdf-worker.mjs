#!/usr/bin/env node
/**
 * Copy pdfjs-dist's worker bundle into public/ so the PDF preview can load it
 * as a static asset — `components/files/file-viewer/PdfViewer.tsx` points
 * pdf.js at `/pdf.worker.min.mjs`.
 *
 * This replaces a `find node_modules … | head -1 | xargs cp …` pipeline. That
 * pipeline cannot run on Windows at all: there is no `xargs`, and `find.exe` is
 * a different program (a text search), so the root `postinstall` failed and
 * `pnpm install` with it. Wired as the root `postinstall`, and listed in
 * package.json's `files` so the published package can run it too.
 *
 * Resolution order, because pdfjs-dist is a dependency of react-pdf rather
 * than a direct one:
 *
 *   1. from the app root — hoisted layouts (npm, `publicHoistPattern`);
 *   2. from react-pdf's own location — pnpm's isolated layout keeps pdfjs-dist
 *      in `.pnpm/`, reachable only through its dependent.
 *
 * The `legacy/build/` copy can never be picked: the specifier below names
 * `build/` exactly, not a glob. A worker that cannot be found is reported but
 * does not fail the install — `public/pdf.worker.min.mjs` is committed, so the
 * preview keeps working, and failing a dependency install over a cache copy is
 * worse than a stale one (same call as scripts/clean-stale-build-types.mjs).
 */
import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const WORKER_SPECIFIER = "pdfjs-dist/build/pdf.worker.min.mjs";
const destination = join(repoRoot, "public", "pdf.worker.min.mjs");

const require = createRequire(import.meta.url);

function resolveWorker() {
  const attempts = [
    () => require.resolve(WORKER_SPECIFIER, { paths: [repoRoot] }),
    () =>
      createRequire(require.resolve("react-pdf/package.json", { paths: [repoRoot] })).resolve(
        WORKER_SPECIFIER,
      ),
  ];
  for (const attempt of attempts) {
    try {
      const found = attempt();
      if (existsSync(found)) return found;
    } catch {
      // Try the next resolution root.
    }
  }
  return undefined;
}

const source = resolveWorker();

if (!source) {
  console.warn(
    "[copy-pdf-worker] pdfjs-dist worker not found — public/pdf.worker.min.mjs left unchanged",
  );
  process.exit(0);
}

copyFileSync(source, destination);
console.log(`[copy-pdf-worker] ${relative(repoRoot, source)} -> public/pdf.worker.min.mjs`);
