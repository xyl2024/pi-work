/**
 * Custom Pi Agent tool: `show_media`.
 *
 * Displays one or more **multimedia** files (image / video / audio) inline
 * below the tool call in the chat UI. Non-multimedia paths (PDF, Markdown,
 * HTML, plain text, binary) are rejected at validation time with a
 * per-path error — the tool is intentionally narrower than its former
 * `show_file` incarnation. For PDFs and code/text previews, use the
 * right-hand file viewer (FileViewer + open_file path).
 *
 * All paths the server accepts are still restricted to the same allowed
 * roots as `/api/files` (sessions' cwds + `~/.pi-work/workspace/pi-cwd-*`),
 * via `lib/file-access.ts`.
 *
 * IMPORTANT: This file imports `@earendil-works/pi-coding-agent`, which
 * transitively pulls in server-only Node modules. Client code that needs
 * the tool name or types must import from `./show-file-tool-types` instead.
 */

import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { getAllowedRoots, isPathAllowed } from "./file-access";
import {
  SHOW_FILE_TOOL_NAME,
  SHOW_FILE_MAX_PATHS,
  SHOW_FILE_ALLOWED_CATEGORIES,
  categorizeByExt,
  type ShowFileDetails,
  type ShowFileEntry,
} from "./show-file-tool-types";

export {
  SHOW_FILE_TOOL_NAME,
  SHOW_FILE_MAX_PATHS,
  SHOW_FILE_ALLOWED_CATEGORIES,
  categorizeByExt,
};
export type { ShowFileCategory, ShowFileDetails, ShowFileEntry } from "./show-file-tool-types";

const ShowFileParams = Type.Object({
  paths: Type.Array(
    Type.String({
      description:
        "Absolute path to a **multimedia** file (image / video / audio) to display inline. Relative paths are resolved against the session's working directory. Accepted formats include images (png/jpg/gif/webp/svg/...), video (mp4/webm/mov/...), and audio (mp3/wav/...). PDFs, Markdown, HTML, plain text, and binary files are NOT accepted here — use the right-hand file viewer for those.",
    }),
    {
      minItems: 1,
      maxItems: SHOW_FILE_MAX_PATHS,
      description: `1 to ${SHOW_FILE_MAX_PATHS} multimedia files to display together in a single tool call.`,
    },
  ),
});

function result<T>(text: string, details: T) {
  return { content: [{ type: "text" as const, text }], details };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function resolvePath(input: string, cwd: string): string {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(cwd, input);
}

function processOne(absPath: string): ShowFileEntry {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch (e) {
    return {
      path: absPath,
      exists: false,
      error: `File not found: ${absPath} (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  if (!stat.isFile()) {
    return {
      path: absPath,
      exists: false,
      error: `Not a regular file: ${absPath}`,
    };
  }

  const category = categorizeByExt(absPath);
  // Reject anything that isn't a multimedia file. Without this guard, an
  // agent could pass a PDF path and the UI would fall back to the
  // right-side file viewer rather than the chat-inline preview that the
  // tool promises — by failing loudly here, the model gets a clear signal
  // to reach for a different surface (FileViewer via open_file in the
  // right-hand panel).
  if (!SHOW_FILE_ALLOWED_CATEGORIES.includes(category as typeof SHOW_FILE_ALLOWED_CATEGORIES[number])) {
    return {
      path: absPath,
      exists: false,
      category,
      error: `Unsupported file category for show_media: "${category}". Only image, video, and audio files are accepted (PDF, Markdown, HTML, plain text, and binary are not).`,
    };
  }

  const size = stat.size;
  return {
    path: absPath,
    exists: true,
    category,
    size,
    summary: `Added ${absPath} to session library in the Pi Work UI (${category}, ${fmtSize(size)})`,
  };
}

export const showFileTool = defineTool<typeof ShowFileParams, ShowFileDetails>({
  name: SHOW_FILE_TOOL_NAME,
  label: "Show Media",
  description:
    "Display up to 5 multimedia files (images, video, audio) in the pi work UI.",
  parameters: ShowFileParams,
  executionMode: "sequential",
  promptSnippet: "Render images, video, and audio files inline in the chat UI.",
  promptGuidelines: [
    "When your work output includes audio, video, or images, use the `show_media` tool to present them to the user interface.",
    "`show_media` accepts up to 5 paths per call (image / video / audio only). Batch related artifacts into a single call when they belong together.",
    "For PDF, Markdown, HTML, plain text, or binary files, do NOT use `show_media` \u2014 it rejects them. Use the right-hand file viewer (the `open_file` flow handled by the chat UI) for those.",
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const rawPaths = params.paths;

    if (rawPaths.length === 0) {
      return result<ShowFileDetails>(
        "Error: At least one path is required.",
        {
          files: [],
          summary: "No paths provided.",
        },
      );
    }

    if (rawPaths.length > SHOW_FILE_MAX_PATHS) {
      return result<ShowFileDetails>(
        `Error: Too many paths (${rawPaths.length}); maximum is ${SHOW_FILE_MAX_PATHS}.`,
        {
          files: [],
          summary: `Too many paths (${rawPaths.length} > ${SHOW_FILE_MAX_PATHS}).`,
        },
      );
    }

    let allowedRoots: Set<string>;
    try {
      allowedRoots = await getAllowedRoots();
    } catch (e) {
      const message = `Failed to check allowed roots: ${e instanceof Error ? e.message : String(e)}`;
      return result<ShowFileDetails>(
        `Error: ${message}`,
        {
          files: rawPaths.map((p) => ({
            path: typeof p === "string" ? resolvePath(p, ctx.cwd) : "",
            exists: false,
            error: message,
          })),
          summary: message,
        },
      );
    }

    const files: ShowFileEntry[] = rawPaths.map((p) => {
      if (typeof p !== "string" || p.length === 0) {
        return {
          path: "",
          exists: false,
          error: "Path must be a non-empty string.",
        };
      }
      const abs = resolvePath(p, ctx.cwd);
      if (!isPathAllowed(abs, allowedRoots)) {
        return {
          path: abs,
          exists: false,
          error: `Path not in allowed roots: ${abs}`,
        };
      }
      return processOne(abs);
    });

    const okCount = files.filter((f) => f.exists).length;
    const failCount = files.length - okCount;
    const summary =
      failCount === 0
        ? `Added ${okCount} file${okCount === 1 ? "" : "s"} to the session library in the Pi Work UI.`
        : `Added ${okCount} of ${files.length} files to the session library in the Pi Work UI; ${failCount} failed.`;

    return result<ShowFileDetails>(summary, { files, summary });
  },
});

export function buildShowFileTool() {
  return [showFileTool];
}
