import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

interface PiExportOptions {
  outputPath?: string;
  themeName?: string;
}

interface PiExportModule {
  exportSessionToHtml(
    sm: SessionManager,
    state?: unknown,
    options?: PiExportOptions | string,
  ): Promise<string>;
}

let cachedModule: PiExportModule | null = null;
let cachedPromise: Promise<PiExportModule> | null = null;

const PI_PACKAGE_REL = join(
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "core",
  "export-html",
  "index.js",
);

function findPiExportHtmlPath(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, PI_PACKAGE_REL);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate @earendil-works/pi-coding-agent/${PI_PACKAGE_REL} from ${process.cwd()}`,
  );
}

function loadPiExportModule(): Promise<PiExportModule> {
  if (cachedModule) return Promise.resolve(cachedModule);
  if (cachedPromise) return cachedPromise;
  const path = findPiExportHtmlPath();
  const dynamicImport = new Function(
    "p",
    "return import(p);",
  ) as (p: string) => Promise<PiExportModule>;
  cachedPromise = dynamicImport(path).then((mod) => {
    cachedModule = mod;
    return mod;
  });
  return cachedPromise;
}

export interface ExportSessionHtmlOptions {
  leafId?: string | null;
  themeName?: string;
}

export async function exportSessionHtmlViaPi(
  sm: SessionManager,
  options: ExportSessionHtmlOptions = {},
): Promise<string> {
  const { exportSessionToHtml } = await loadPiExportModule();

  if (options.leafId != null) {
    (sm as unknown as { leafId: string | null }).leafId = options.leafId;
  }

  const tmpPath = join(
    tmpdir(),
    `pi-work-export-${randomBytes(8).toString("hex")}.html`,
  );

  try {
    await exportSessionToHtml(sm, undefined, {
      outputPath: tmpPath,
      themeName: options.themeName,
    });
    return readFileSync(tmpPath, "utf8");
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
    }
  }
}