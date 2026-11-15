import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { planMemoryMigration } from "@/lib/shared/memory-two-tier";
import { createLogger } from "./logger";
import { dataPath } from "./data-dir";
import { writeFileAtomic } from "./atomic-write";

const log = createLogger("memory/migration");

const LEGACY_FILES = ["MEMORY.md", "USER.md"] as const;

function readLegacyFile(dir: string, name: string): string | null {
  const filePath = join(dir, name);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

export function runMemoryMigration(memoryDir: string = dataPath("memory")): void {
  try {
    const memoryRaw = readLegacyFile(memoryDir, "MEMORY.md");
    const userRaw = readLegacyFile(memoryDir, "USER.md");
    if (memoryRaw === null && userRaw === null) return;

    const plan = planMemoryMigration({ memoryRaw, userRaw });
    if (plan) {
      for (const file of [...plan.files, plan.index]) {
        writeFileAtomic(join(memoryDir, file.path), file.content);
      }
    }
    for (const name of LEGACY_FILES) {
      if (!existsSync(join(memoryDir, name))) continue;
      renameSync(join(memoryDir, name), join(memoryDir, `${name}.bak`));
    }
  } catch (error) {
    log.warn(
      "memory migration failed, continuing:",
      error instanceof Error ? error.message : error,
    );
  }
}
