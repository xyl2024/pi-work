"use client";

import type { SlashResource } from "@/lib/slash-commands";

/**
 * 156px-high preview pane shown between the image attachments and the
 * textarea once the user has selected a prompt-style slash command. The
 * header shows the `prompt` source badge and the command, the body shows
 * the template text with any `$N` placeholders already substituted by
 * the parent (`selectedPromptPreview` is the fully-expanded string).
 *
 * Pure presentational — null when `selectedPromptResource` is null or
 * the preview string hasn't been computed yet.
 */
export function PromptPreview({ resource, preview }: {
  resource: SlashResource;
  preview: string | null;
}) {
  if (preview === null) return null;
  return (
    <div style={{
      height: 156,
      marginBottom: 8,
      background: "var(--bg-panel)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        borderBottom: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
        color: "var(--text-muted)",
        fontSize: 12,
      }}>
        <span style={{ color: "var(--accent)", fontWeight: 700, textTransform: "uppercase", fontSize: 10 }}>
          prompt
        </span>
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          /{resource.command}
        </span>
      </div>
      <pre style={{
        margin: 0,
        padding: "9px 10px",
        flex: 1,
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: "var(--text)",
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily: "var(--font-mono)",
      }}>
        {preview}
      </pre>
    </div>
  );
}
