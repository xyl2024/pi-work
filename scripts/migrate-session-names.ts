#!/usr/bin/env node

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { readSessionName, writeSessionName } from "@/lib/server/session-names";

const PARALLELISM = 32;
const CHUNK = 64 * 1024;
const PROGRESS_EVERY = PARALLELISM * 4;

interface ScanResult {
  id: string;
  name?: string;
}

function scanFileForIdAndLatestName(filePath: string): ScanResult | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const st = statSync(filePath);
    const dec = new StringDecoder("utf8");
    let pos = 0;
    let id: string | undefined;
    let name: string | undefined;
    let leftover = "";
    while (pos < st.size) {
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, st.size - pos));
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      pos += n;
      leftover += dec.write(buf.subarray(0, n));
      const lines = leftover.split("\n");
      leftover = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!entry || typeof entry !== "object") continue;
        const entryType = (entry as { type?: unknown }).type;
        if (!id && entryType === "session" && typeof (entry as { id?: unknown }).id === "string") {
          id = (entry as { id: string }).id;
          continue;
        }
        if (entryType === "session_info" && typeof (entry as { name?: unknown }).name === "string") {
          const trimmed = ((entry as { name: string }).name).trim();
          if (trimmed) name = trimmed;
        }
      }
    }
    if (leftover) {
      try {
        const entry = JSON.parse(leftover) as Record<string, unknown>;
        if (entry && entry.type === "session_info" && typeof entry.name === "string") {
          const trimmed = entry.name.trim();
          if (trimmed) name = trimmed;
        }
      } catch {
      }
    }
    if (!id) return null;
    const r: ScanResult = { id };
    if (name) r.name = name;
    return r;
  } finally {
    closeSync(fd);
  }
}

async function listAllJsonlFiles(sessionsDir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await (await import("node:fs/promises")).readdir(sessionsDir, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const { readdir } = await import("node:fs/promises");
  const allFiles: string[] = [];
  for (const entry of entries) {
    if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
    const dir = join(sessionsDir, entry.name);
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (f.endsWith(".jsonl")) allFiles.push(join(dir, f));
      }
    } catch {
    }
  }
  return allFiles;
}

type Action = "write" | "skip" | "no-name";

async function migrateOne(file: string, force: boolean): Promise<{ action: Action; id?: string }> {
  const result = scanFileForIdAndLatestName(file);
  if (!result) throw new Error("no header id");
  if (!result.name) return { action: "no-name" };
  if (!force && readSessionName(result.id)) {
    return { action: "skip", id: result.id };
  }
  writeSessionName(result.id, result.name);
  return { action: "write", id: result.id };
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const home = homedir();
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
  const sessionsDir = join(agentDir, "sessions");
  console.log(`sessions dir: ${sessionsDir}`);
  console.log(`mode: ${force ? "FORCE (overwrite existing sidecars)" : "skip existing sidecars"}`);

  const t0 = performance.now();
  const files = await listAllJsonlFiles(sessionsDir);
  console.log(`found ${files.length} .jsonl files (${(performance.now() - t0).toFixed(0)}ms)\n`);

  let written = 0;
  let skipped = 0;
  let noName = 0;
  let errors = 0;
  const started = performance.now();

  for (let i = 0; i < files.length; i += PARALLELISM) {
    const batch = files.slice(i, i + PARALLELISM);
    const results = await Promise.allSettled(batch.map((f) => migrateOne(f, force)));
    for (const r of results) {
      if (r.status === "rejected") {
        errors++;
        continue;
      }
      switch (r.value.action) {
        case "write":
          written++;
          break;
        case "skip":
          skipped++;
          break;
        case "no-name":
          noName++;
          break;
      }
    }
    const done = Math.min(i + PARALLELISM, files.length);
    if (done % PROGRESS_EVERY === 0 || done === files.length) {
      const elapsedMs = performance.now() - started;
      const rate = done / (elapsedMs / 1000);
      console.log(
        `  ${done}/${files.length}  (${rate.toFixed(0)} files/s, written=${written}, skipped=${skipped}, no-name=${noName}, errors=${errors})`,
      );
    }
  }

  const totalMs = performance.now() - started;
  console.log(`\nDone in ${(totalMs / 1000).toFixed(2)}s`);
  console.log(`  written   ${written}    (new sidecars created)`);
  console.log(`  skipped   ${skipped}    (already had a sidecar and --force not set)`);
  console.log(`  no-name   ${noName}     (file has no session_info entry — nothing to migrate)`);
  console.log(`  errors    ${errors}     (unreadable / malformed — see earlier output)`);
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
