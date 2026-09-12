import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAllowedRoots, isPathAllowed } from "@/lib/server/file-access";
import { IGNORED_NAMES, IGNORED_SUFFIXES } from "@/lib/server/files/handler";

function inside(base: string, candidate: string): boolean {
  const root = path.resolve(base);
  const target = path.resolve(candidate);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd");
  const directory = request.nextUrl.searchParams.get("directory") ?? "";
  if (!cwd) return NextResponse.json({ error: "Missing cwd" }, { status: 400 });

  try {
    const roots = await getAllowedRoots();
    if (!isPathAllowed(cwd, roots)) return NextResponse.json({ error: "CWD is not allowed" }, { status: 403 });

    const realCwd = await fs.realpath(cwd);
    const target = path.resolve(cwd, directory);
    if (!inside(cwd, target) || !isPathAllowed(target, roots)) {
      return NextResponse.json({ error: "Directory is not allowed" }, { status: 403 });
    }
    const realTarget = await fs.realpath(target);
    if (!inside(realCwd, realTarget)) {
      return NextResponse.json({ error: "Directory is outside CWD" }, { status: 403 });
    }
    const targetStat = await fs.stat(realTarget);
    if (!targetStat.isDirectory()) return NextResponse.json({ error: "Not a directory" }, { status: 400 });

    const names = await fs.readdir(realTarget);
    const entries = (await Promise.all(names
      .filter((name) => !IGNORED_NAMES.has(name) && !IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix)))
      .map(async (name) => {
        try {
          const entryPath = path.join(realTarget, name);
          const linkStat = await fs.lstat(entryPath);
          const isDir = linkStat.isDirectory() || linkStat.isSymbolicLink() && (await fs.stat(entryPath).catch(() => null))?.isDirectory() === true;
          return { name, isDir, isSymlink: linkStat.isSymbolicLink() };
        } catch {
          return null;
        }
      })))
      .filter((entry): entry is { name: string; isDir: boolean; isSymlink: boolean } => Boolean(entry))
      .sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name));

    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
