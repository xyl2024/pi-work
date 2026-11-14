import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataPath } from "./data-dir";

export const SYNTHESIS_CACHE_DIRECTORY = "synthesis-cache";

export const SYNTHESIS_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;

export const SYNTHESIS_CACHE_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

const CACHE_FILE_EXTENSION = ".wav";

export interface SynthesisCacheOptions {
  directory?: string;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

export interface SynthesisCache {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, audio: Uint8Array): Promise<void>;
}

interface CacheEntry {
  path: string;
  size: number;
  usedAt: number;
}

export function synthesisCacheKey(text: string, voiceId: string): string {
  return createHash("sha256").update(`${voiceId}\u0000${text}`).digest("hex");
}

export function createSynthesisCache(options: SynthesisCacheOptions = {}): SynthesisCache {
  const maxEntryBytes = options.maxEntryBytes ?? SYNTHESIS_CACHE_MAX_ENTRY_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? SYNTHESIS_CACHE_MAX_TOTAL_BYTES;
  const directory = () => options.directory ?? dataPath(SYNTHESIS_CACHE_DIRECTORY);
  const filePath = (key: string) => join(directory(), `${key}${CACHE_FILE_EXTENSION}`);

  async function usedEntries(): Promise<CacheEntry[]> {
    let names: string[];
    try {
      names = await readdir(directory());
    } catch {
      return [];
    }
    const entries: CacheEntry[] = [];
    for (const name of names) {
      if (!name.endsWith(CACHE_FILE_EXTENSION)) continue;
      const path = join(directory(), name);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        entries.push({ path, size: info.size, usedAt: info.atimeMs || info.mtimeMs });
      } catch {
        continue;
      }
    }
    return entries;
  }

  async function evict(): Promise<void> {
    const entries = await usedEntries();
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes <= maxTotalBytes) return;
    entries.sort((left, right) => left.usedAt - right.usedAt);
    for (const entry of entries) {
      if (totalBytes <= maxTotalBytes) return;
      try {
        await unlink(entry.path);
        totalBytes -= entry.size;
      } catch {
        continue;
      }
    }
  }

  async function read(key: string): Promise<Uint8Array | null> {
    const path = filePath(key);
    try {
      const audio = await readFile(path);
      if (audio.byteLength === 0 || audio.byteLength > maxEntryBytes) return null;
      const now = new Date();
      await utimes(path, now, now).catch(() => {});
      return new Uint8Array(audio);
    } catch {
      return null;
    }
  }

  async function write(key: string, audio: Uint8Array): Promise<void> {
    if (audio.byteLength === 0 || audio.byteLength > maxEntryBytes) return;
    const path = filePath(key);
    const partialPath = `${path}.${process.pid}.${Date.now()}.partial`;
    try {
      await mkdir(directory(), { recursive: true });
      await writeFile(partialPath, audio);
      await rename(partialPath, path);
    } catch {
      await unlink(partialPath).catch(() => {});
      return;
    }
    await evict();
  }

  return { read, write };
}

const pendingSyntheses = new Map<string, Promise<unknown>>();

export function coalesceSynthesis<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = pendingSyntheses.get(key);
  if (pending) return pending as Promise<T>;
  const created = run().finally(() => {
    if (pendingSyntheses.get(key) === created) pendingSyntheses.delete(key);
  });
  pendingSyntheses.set(key, created);
  return created;
}
