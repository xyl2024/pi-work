import type { ComposerDoc, ComposerImageNode, SerializedComposer } from "./types";

export function codeSpan(path: string): string {
  let longest = 0;
  for (const match of path.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}${path}${fence}`;
}

export function formatFileReference(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return codeSpan(`./${normalized}`);
}

export function serializeComposer(doc: ComposerDoc): SerializedComposer {
  let text = "";
  const images: ComposerImageNode[] = [];

  for (let index = 0; index < doc.nodes.length; index += 1) {
    const node = doc.nodes[index];

    if (node.kind === "text") {
      text += node.text;
      continue;
    }

    if (node.kind === "image") {
      images.push(node);
      continue;
    }

    if (node.kind === "file") {
      const following = doc.nodes[index + 1];
      const followingText = following?.kind === "text" ? following.text : "";
      text += formatFileReference(node.relativePath);
      text += /^\s/.test(followingText) ? "" : " ";
      continue;
    }

    text += `/skill:${node.name}`;
    const following = doc.nodes[index + 1];
    if (!following) continue;
    if (following.kind !== "text") {
      text += " ";
      continue;
    }
    if (following.text.length > 0 && !/^\s/.test(following.text)) text += " ";
  }

  return { text, images };
}

export function isComposerEmpty(doc: ComposerDoc): boolean {
  return serializeComposer(doc).text.length === 0 && !doc.nodes.some((node) => node.kind === "image");
}
