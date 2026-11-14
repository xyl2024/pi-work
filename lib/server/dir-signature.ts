import { statSync } from "node:fs";

export function directorySignature(dir: string): string | null {
  try {
    const stat = statSync(dir);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}
