import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "@/lib/shared/types";
import { cleanFirstMessage } from "@/lib/shared/session-title";
import { dataPath } from "../data-dir";
import { createLogger } from "../logger";
import { invalidateSessionNamesCache, listSessionNames } from "../session-names";
import { scanSessionHeader, type SessionHeaderScan } from "./header";

interface IndexEntry {
  mtimeMs: number;
  size: number;
  header?: SessionHeaderScan;
}

interface IndexState {
  agentDir: string;
  entries: Map<string, IndexEntry>;
  byId: Map<string, string>;
  snapshot: SessionInfo[];
  refreshing: Promise<SessionInfo[]> | null;
  diskLoaded: boolean;
  dirty: boolean;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

declare global {
  var __piSessionIndex: IndexState | undefined;
}

const STAT_CONCURRENCY = 32;
const READ_CONCURRENCY = 16;
const PERSIST_DELAY_MS = 500;
const DISK_VERSION = 1;

const log = createLogger("sessions/index");

function getState(): IndexState {
  const agentDir = getAgentDir();
  const existing = globalThis.__piSessionIndex;
  if (existing && existing.agentDir === agentDir) return existing;
  const state: IndexState = {
    agentDir,
    entries: new Map(),
    byId: new Map(),
    snapshot: [],
    refreshing: null,
    diskLoaded: false,
    dirty: false,
    persistTimer: null,
  };
  globalThis.__piSessionIndex = state;
  return state;
}

export async function listSessionsFromIndex(): Promise<SessionInfo[]> {
  const state = getState();
  if (!state.refreshing) {
    state.refreshing = refresh(state).finally(() => {
      state.refreshing = null;
    });
  }
  return state.refreshing;
}

export function isSessionIndexLoaded(): boolean {
  return (globalThis.__piSessionIndex?.entries.size ?? 0) > 0;
}

export async function warmSessionIndex(): Promise<void> {
  await listSessionsFromIndex();
}

export async function sessionPathFromIndex(sessionId: string): Promise<string | null> {
  await listSessionsFromIndex();
  return getState().byId.get(sessionId) ?? null;
}

export function invalidateSessionIndex(): void {
  invalidateSessionNamesCache();
}

export function invalidateSessionIndexEntry(sessionId: string): void {
  const state = globalThis.__piSessionIndex;
  if (!state) return;
  const filePath = state.byId.get(sessionId);
  if (!filePath) return;
  state.entries.delete(filePath);
  state.byId.delete(sessionId);
  state.dirty = true;
}

async function mapLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await run(items[index]);
    }
  });
  await Promise.all(workers);
}

async function collectSessionFiles(agentDir: string): Promise<string[]> {
  const sessionsDir = `${agentDir}/sessions`;
  let subdirs: string[] = [];
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    subdirs = entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(sessionsDir, entry.name));
  } catch {
    return [];
  }

  const files: string[] = [];
  await mapLimit(subdirs, READ_CONCURRENCY, async (dir) => {
    try {
      const names = await readdir(dir);
      for (const name of names) {
        if (name.endsWith(".jsonl")) files.push(join(dir, name));
      }
    } catch {
    }
  });
  return files;
}

async function refresh(state: IndexState): Promise<SessionInfo[]> {
  const startedAt = Date.now();
  await loadDiskIndex(state);
  const names = await listSessionNames();
  const files = await collectSessionFiles(state.agentDir);
  const live = new Set(files);

  for (const filePath of [...state.entries.keys()]) {
    if (!live.has(filePath)) {
      state.entries.delete(filePath);
      state.dirty = true;
    }
  }

  const changed: string[] = [];
  await mapLimit(files, STAT_CONCURRENCY, async (filePath) => {
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return;
    }
    const previous = state.entries.get(filePath);
    if (previous && previous.mtimeMs === fileStat.mtimeMs && previous.size === fileStat.size) return;
    state.entries.set(filePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size });
    changed.push(filePath);
    state.dirty = true;
  });

  if (changed.length > 0) {
    await mapLimit(changed, READ_CONCURRENCY, async (filePath) => {
      const entry = state.entries.get(filePath);
      if (!entry) return;
      const header = await scanSessionHeader(filePath, {
        knownNameFor: (sessionId) => names.get(sessionId)?.name,
        size: entry.size,
      });
      if (!header) {
        state.entries.delete(filePath);
        return;
      }
      entry.header = header;
    });
  }

  state.snapshot = buildSnapshot(state, names);
  schedulePersist(state);
  log.debug("session index refreshed", {
    files: files.length,
    reread: changed.length,
    sessions: state.snapshot.length,
    durationMs: Date.now() - startedAt,
  });
  return state.snapshot;
}

function buildSnapshot(state: IndexState, names: Map<string, { name: string }>): SessionInfo[] {
  const pathToId = new Map<string, string>();
  for (const [filePath, entry] of state.entries) {
    if (!entry.header) continue;
    pathToId.set(filePath, entry.header.id);
  }

  const byId = new Map<string, string>();
  const seen = new Set<string>();
  const out: SessionInfo[] = [];
  for (const [filePath, entry] of state.entries) {
    const header = entry.header;
    if (!header) continue;
    if (seen.has(header.id)) continue;
    seen.add(header.id);
    byId.set(header.id, filePath);
    const info: SessionInfo = {
      path: filePath,
      id: header.id,
      cwd: header.cwd,
      created: header.created,
      modified: new Date(entry.mtimeMs).toISOString(),
      messageCount: 0,
      firstMessage: cleanFirstMessage(header.firstMessage),
      parentSessionId: header.parentSessionPath ? pathToId.get(header.parentSessionPath) : undefined,
      running: false,
    };
    const name = names.get(header.id)?.name ?? header.name;
    if (name) info.name = name;
    if (header.assistant) info.assistant = true;
    out.push(info);
  }
  out.sort((a, b) => b.modified.localeCompare(a.modified));
  state.byId = byId;
  return out;
}

interface DiskIndex {
  version: number;
  agentDir: string;
  entries: Array<{ path: string; mtimeMs: number; size: number; header: SessionHeaderScan }>;
}

function diskIndexPath(): string {
  return dataPath("session-index.json");
}

function isHeaderScan(value: unknown): value is SessionHeaderScan {
  if (!value || typeof value !== "object") return false;
  const header = value as { id?: unknown; cwd?: unknown; created?: unknown };
  return typeof header.id === "string" && typeof header.cwd === "string" && typeof header.created === "string";
}

async function loadDiskIndex(state: IndexState): Promise<void> {
  if (state.diskLoaded) return;
  state.diskLoaded = true;
  let parsed: DiskIndex;
  try {
    parsed = JSON.parse(await readFile(diskIndexPath(), "utf8")) as DiskIndex;
  } catch {
    return;
  }
  if (!parsed || parsed.version !== DISK_VERSION || parsed.agentDir !== state.agentDir) return;
  if (!Array.isArray(parsed.entries)) return;
  for (const row of parsed.entries) {
    if (!row || typeof row.path !== "string") continue;
    if (typeof row.mtimeMs !== "number" || typeof row.size !== "number") continue;
    if (!isHeaderScan(row.header)) continue;
    state.entries.set(row.path, { mtimeMs: row.mtimeMs, size: row.size, header: row.header });
  }
}

function schedulePersist(state: IndexState): void {
  if (!state.dirty || state.persistTimer) return;
  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    void persist(state);
  }, PERSIST_DELAY_MS);
  state.persistTimer.unref?.();
}

async function persist(state: IndexState): Promise<void> {
  if (!state.dirty) return;
  state.dirty = false;
  const payload: DiskIndex = {
    version: DISK_VERSION,
    agentDir: state.agentDir,
    entries: [...state.entries].flatMap(([filePath, entry]) =>
      entry.header
        ? [{ path: filePath, mtimeMs: entry.mtimeMs, size: entry.size, header: entry.header }]
        : [],
    ),
  };
  const target = diskIndexPath();
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    await rename(tmp, target);
  } catch {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp);
    } catch {
    }
  }
}
