#!/usr/bin/env node
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
