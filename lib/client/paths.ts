"use client";

export function shortenPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
