import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createLogger, elapsedMs } from "@/lib/logger";
import { filePathFromSegments } from "@/lib/file-access";
import { readConfig } from "@/lib/config";

/**
 * Shared GET handler + helpers for the files API.
 *
 * Mounted at both `/api/files/[...path]` (catch-all) and `/api/files`
 * (zero segments → filesystem root `/`). Next.js route files may only
 * export route handlers (its generated types enforce that), so everything
 * the GET handler needs lives in this non-route module instead.
 */

export const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store", ".git",
]);

export const IGNORED_SUFFIXES = [".pyc"];

const log = createLogger("api/files");

/**
 * Read the per-kind preview-size limits (in MB) from ~/.pi-work/config.yaml.
 * Falls back to defaults if the config is missing/garbled — `readConfig` is
 * fail-open, so the file route never blocks on user YAML errors.
 */
function getPreviewLimits(): { text: number; image: number; pdf: number } {
  return readConfig().file_viewer.max_size_mb;
}

/**
 * Build a 413 response for "file too large" rejections. Returns a
 * machine-readable shape (code/kind/sizeBytes/limitBytes) so the
 * SettingsModal/FilViewer can i18n the user-facing message client-side
 * and so future features (e.g. an "Open settings" button) can detect
 * this error category without string-matching the message. The English
 * `error` field is still populated for `curl` / log readability.
 */
function fileTooLargeResponse(
  kind: "image" | "text" | "pdf",
  sizeBytes: number,
  limitMb: number,
): NextResponse {
  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
  const error = `${kind} file too large: ${sizeMb} MB exceeds the ${limitMb} MB limit`;
  return NextResponse.json(
    {
      error,
      code: "FILE_TOO_LARGE",
      kind,
      sizeBytes,
      limitBytes: limitMb * 1024 * 1024,
    },
    { status: 413 },
  );
}

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "audio/webm",
};

const VIDEO_EXT_TO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  ogg: "video/ogg",
};

const PDF_EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
};

function getExt(filePath: string): string {
  const ext = path.basename(filePath).toLowerCase().split(".").pop() ?? "";
  return ext;
}

function getImageMime(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[getExt(filePath)] ?? null;
}

function getAudioMime(filePath: string): string | null {
  return AUDIO_EXT_TO_MIME[getExt(filePath)] ?? null;
}

function getVideoMime(filePath: string): string | null {
  return VIDEO_EXT_TO_MIME[getExt(filePath)] ?? null;
}

function getPdfMime(filePath: string): string | null {
  return PDF_EXT_TO_MIME[getExt(filePath)] ?? null;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
};

function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  // Special full-name matches
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function jsonOk(data: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { status });
}

function createFileBodyStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const fileStream = fs.createReadStream(filePath, range);
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      fileStream.on("data", (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          closed = true;
          fileStream.destroy();
        }
      });
      fileStream.once("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser may cancel media probes before the file stream ends.
        }
      });
      fileStream.once("error", (error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(error);
        } catch {
          // The response was already abandoned by the client.
        }
      });
    },
    cancel() {
      closed = true;
      fileStream.destroy();
    },
  });
}

function streamFile(filePath: string, stat: fs.Stats, contentType: string, rangeHeader: string | null): Response {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
  };

  if (!rangeHeader) {
    return new Response(createFileBodyStream(filePath), {
      headers: {
        ...headers,
        "Content-Length": String(stat.size),
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  end = Math.min(end, stat.size - 1);
  const chunkSize = end - start + 1;
  return new Response(createFileBodyStream(filePath, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

/**
 * GET logic for the files API. `segments` are the decoded path segments
 * from the route params; an empty array means the filesystem root.
 */
export async function handleFilesGet(request: NextRequest, segments: string[]): Promise<Response> {
  const startedAt = Date.now();
  try {
    const filePath = filePathFromSegments(segments);
    const type = request.nextUrl.searchParams.get("type") ?? "list";
    log.debug("file request received", { type, path: filePath });

    // GET is intentionally not gated by getAllowedRoots()/isPathAllowed().
    // Read paths (list/read/watch, image/audio/video/pdf streaming) are
    // unrestricted; write paths (PUT/POST/DELETE/PATCH) keep the check.

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      log.warn("file request not found", { type, path: filePath, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (type === "read") {
      if (!stat.isFile()) {
        log.warn("file read rejected", { path: filePath, reason: "not a file", durationMs: elapsedMs(startedAt) });
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      const limits = getPreviewLimits();
      const textLimit = limits.text * 1024 * 1024;
      const imageLimit = limits.image * 1024 * 1024;
      const pdfLimit = limits.pdf * 1024 * 1024;
      const imageMime = getImageMime(filePath);
      if (imageMime) {
        if (stat.size > imageLimit) {
          log.warn("image read rejected", { path: filePath, size: stat.size, limitBytes: imageLimit, durationMs: elapsedMs(startedAt) });
          return fileTooLargeResponse("image", stat.size, limits.image);
        }
        log.info("image read streamed", {
          path: filePath,
          size: stat.size,
          contentType: imageMime,
          range: request.headers.get("range") ?? undefined,
          durationMs: elapsedMs(startedAt),
        });
        return streamFile(filePath, stat, imageMime, request.headers.get("range"));
      }
      const audioMime = getAudioMime(filePath);
      if (audioMime) {
        log.info("audio read streamed", {
          path: filePath,
          size: stat.size,
          contentType: audioMime,
          range: request.headers.get("range") ?? undefined,
          durationMs: elapsedMs(startedAt),
        });
        return streamFile(filePath, stat, audioMime, request.headers.get("range"));
      }
      const videoMime = getVideoMime(filePath);
      if (videoMime) {
        log.info("video read streamed", {
          path: filePath,
          size: stat.size,
          contentType: videoMime,
          range: request.headers.get("range") ?? undefined,
          durationMs: elapsedMs(startedAt),
        });
        return streamFile(filePath, stat, videoMime, request.headers.get("range"));
      }
      const pdfMime = getPdfMime(filePath);
      if (pdfMime) {
        if (stat.size > pdfLimit) {
          log.warn("pdf read rejected", { path: filePath, size: stat.size, limitBytes: pdfLimit, durationMs: elapsedMs(startedAt) });
          return fileTooLargeResponse("pdf", stat.size, limits.pdf);
        }
        log.info("pdf read streamed", {
          path: filePath,
          size: stat.size,
          contentType: pdfMime,
          range: request.headers.get("range") ?? undefined,
          durationMs: elapsedMs(startedAt),
        });
        return streamFile(filePath, stat, pdfMime, request.headers.get("range"));
      }
      if (stat.size > textLimit) {
        log.warn("text read rejected", { path: filePath, size: stat.size, limitBytes: textLimit, durationMs: elapsedMs(startedAt) });
        return fileTooLargeResponse("text", stat.size, limits.text);
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const language = getLanguage(filePath);
      log.info("text file read", {
        path: filePath,
        size: stat.size,
        language,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ content, language, size: stat.size });
    }

    if (type === "watch") {
      if (!stat.isFile()) {
        log.warn("file watch rejected", { path: filePath, reason: "not a file", durationMs: elapsedMs(startedAt) });
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      let watcher: fs.FSWatcher | null = null;
      const stream = new ReadableStream({
        start(controller) {
          const send = (eventName: string, data: Record<string, unknown>) => {
            const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
            try {
              controller.enqueue(new TextEncoder().encode(payload));
            } catch {
              // client disconnected
            }
          };
          // Send initial ping so client knows connection is live
          send("connected", { filePath });
          try {
            watcher = fs.watch(filePath, () => {
              try {
                const s = fs.statSync(filePath);
                send("change", { mtime: s.mtime.toISOString(), size: s.size });
              } catch {
                send("change", { mtime: new Date().toISOString(), size: 0 });
              }
            });
            watcher.on("error", () => {
              log.warn("file watch error", { path: filePath, durationMs: elapsedMs(startedAt) });
              try { controller.close(); } catch { /* ignore */ }
            });
          } catch {
            log.warn("file watch failed to start", { path: filePath, durationMs: elapsedMs(startedAt) });
            send("error", { message: "Failed to watch file" });
            controller.close();
          }
        },
        cancel() {
          try { watcher?.close(); } catch { /* ignore */ }
          log.info("file watch closed", { path: filePath, durationMs: elapsedMs(startedAt) });
        },
      });
      log.info("file watch connected", { path: filePath, durationMs: elapsedMs(startedAt) });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // type === "list"
    if (!stat.isDirectory()) {
      log.warn("directory list rejected", { path: filePath, reason: "not a directory", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const names = fs.readdirSync(filePath);
    const entries = names
      .filter((name) => !IGNORED_NAMES.has(name) && !IGNORED_SUFFIXES.some((s) => name.endsWith(s)))
      .map((name) => {
        const full = path.join(filePath, name);
        try {
          const s = fs.statSync(full);
          return {
            name,
            isDir: s.isDirectory(),
            size: s.isFile() ? s.size : 0,
            modified: s.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        // Dirs first, then files, both alphabetically
        if (a!.isDir !== b!.isDir) return a!.isDir ? -1 : 1;
        return a!.name.localeCompare(b!.name);
      });

    log.info("directory listed", {
      path: filePath,
      entryCount: entries.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ entries, path: filePath });
  } catch (error) {
    log.error("file request failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
