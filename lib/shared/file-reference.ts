import { normalizeFilePathSlashes } from "./file-paths";

function codeSpan(value: string): string {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}${value}${fence}`;
}

export function formatFilePathReference(relativePath: string): string {
  const normalized = normalizeFilePathSlashes(relativePath).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  return `${codeSpan(`./${normalized}`)} `;
}
