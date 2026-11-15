import { mkdir, writeFile, utimes } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as listFiles } from "@/app/api/memory/files/route";
import {
  DELETE as deleteFileRoute,
  GET as readFile,
  POST as createFileRoute,
  PUT as writeFileRoute,
} from "@/app/api/memory/file/route";
import { readConfig, writeConfig } from "@/lib/server/config";
import { createSandbox, resetPiWorkRuntimeState } from "./sandbox";

function setMemoryEnabled(enabled: boolean): void {
  writeConfig({ ...readConfig(), memory: { enabled } });
}

async function writeMemoryFile(dataDir: string, name: string, content: string): Promise<void> {
  const memoryDir = join(dataDir, "memory");
  await mkdir(memoryDir, { recursive: true });
  await writeFile(join(memoryDir, name), content, "utf8");
}

async function bumpMemoryFileMtime(dataDir: string, name: string): Promise<void> {
  const path = join(dataDir, "memory", name);
  const stat = statSync(path);
  const later = new Date(stat.mtimeMs + 5000);
  await utimes(path, later, later);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const INDEX = [
  "# 记忆索引",
  "",
  "## 分类目录",
  "- agent-notes.md — Agent 工作笔记",
  "- user-profile.md — 用户资料与偏好",
  "",
  "## 用户偏好摘要",
  "（待整理）",
].join("\n");

interface MemoryFileEntry {
  file: string;
  isIndex: boolean;
  description: string;
}

describe("memory main view api", () => {
  it("rejects every call while memory is disabled", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    await writeMemoryFile(dataDir, "agent-notes.md", "内容");
    setMemoryEnabled(false);

    const list = await listFiles();
    expect(list.status).toBe(404);

    const read = await readFile(new Request("http://localhost/api/memory/file?file=agent-notes.md"));
    expect(read.status).toBe(404);

    const write = await writeFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "agent-notes.md", content: "hello" }),
      }),
    );
    expect(write.status).toBe(404);
    resetPiWorkRuntimeState();
  });

  it("lists files with the index first and index descriptions", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    await writeMemoryFile(dataDir, "INDEX.md", INDEX);
    await writeMemoryFile(dataDir, "agent-notes.md", "笔记内容");
    await writeMemoryFile(dataDir, "user-profile.md", "用户内容");

    const response = await listFiles();
    expect(response.status).toBe(200);
    const files = ((await json(response)).files as MemoryFileEntry[]).map(
      ({ file, isIndex, description }) => ({ file, isIndex, description }),
    );

    expect(files[0]).toEqual({ file: "INDEX.md", isIndex: true, description: "" });
    const byName = new Map(files.map((file) => [file.file, file]));
    expect(byName.get("agent-notes.md")).toEqual({
      file: "agent-notes.md",
      isIndex: false,
      description: "Agent 工作笔记",
    });
    expect(byName.get("user-profile.md")?.description).toBe("用户资料与偏好");
    resetPiWorkRuntimeState();
  });

  it("reads and writes a file's full text", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    await writeMemoryFile(dataDir, "roundtrip.md", "第一版");

    const read = await readFile(new Request("http://localhost/api/memory/file?file=roundtrip.md"));
    expect(read.status).toBe(200);
    expect((await json(read)).content).toBe("第一版");

    const write = await writeFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "roundtrip.md", content: "第二版" }),
      }),
    );
    expect(write.status).toBe(200);

    const reread = await readFile(new Request("http://localhost/api/memory/file?file=roundtrip.md"));
    expect((await json(reread)).content).toBe("第二版");
    resetPiWorkRuntimeState();
  });

  it("rejects path escapes and non-md targets", async () => {
    createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    for (const file of ["../config.yaml", "/etc/passwd", "a/b.md", "notes.txt", ".."]) {
      const read = await readFile(
        new Request(`http://localhost/api/memory/file?file=${encodeURIComponent(file)}`),
      );
      expect(read.status).toBe(400);
      const write = await writeFileRoute(
        new Request("http://localhost/api/memory/file", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file, content: "x" }),
        }),
      );
      expect(write.status).toBe(400);
    }
    resetPiWorkRuntimeState();
  });

  it("creates an empty category file and rejects duplicates", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    await writeMemoryFile(dataDir, "INDEX.md", INDEX);

    const create = await createFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "new-category.md" }),
      }),
    );
    expect(create.status).toBe(200);
    const content = await readFile(
      new Request("http://localhost/api/memory/file?file=new-category.md"),
    );
    expect((await json(content)).content).toBe("");

    const duplicate = await createFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "new-category.md" }),
      }),
    );
    expect(duplicate.status).toBe(409);

    const asIndex = await createFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "INDEX.md" }),
      }),
    );
    expect(asIndex.status).toBe(400);

    const invalid = await createFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "a/b.md" }),
      }),
    );
    expect(invalid.status).toBe(400);
    resetPiWorkRuntimeState();
  });

  it("deletes a category file and cleans its index registration line", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    await writeMemoryFile(dataDir, "INDEX.md", INDEX);
    await writeMemoryFile(dataDir, "agent-notes.md", "笔记内容");
    await writeMemoryFile(dataDir, "user-profile.md", "用户内容");

    const remove = await deleteFileRoute(
      new Request("http://localhost/api/memory/file?file=agent-notes.md", { method: "DELETE" }),
    );
    expect(remove.status).toBe(200);

    const gone = await readFile(
      new Request("http://localhost/api/memory/file?file=agent-notes.md"),
    );
    expect(gone.status).toBe(404);

    const index = await readFile(new Request("http://localhost/api/memory/file?file=INDEX.md"));
    expect((await json(index)).content).toBe(
      INDEX.replace("- agent-notes.md — Agent 工作笔记\n", ""),
    );
    resetPiWorkRuntimeState();
  });

  it("rejects deleting INDEX.md and missing files", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    await writeMemoryFile(dataDir, "INDEX.md", INDEX);
    await writeMemoryFile(dataDir, "agent-notes.md", "笔记内容");

    const asIndex = await deleteFileRoute(
      new Request("http://localhost/api/memory/file?file=INDEX.md", { method: "DELETE" }),
    );
    expect(asIndex.status).toBe(400);

    const missing = await deleteFileRoute(
      new Request("http://localhost/api/memory/file?file=missing-file.md", { method: "DELETE" }),
    );
    expect(missing.status).toBe(404);

    const index = await readFile(new Request("http://localhost/api/memory/file?file=INDEX.md"));
    expect((await json(index)).content).toBe(INDEX);
    resetPiWorkRuntimeState();
  });

  it("rejects create and delete while memory is disabled", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    await writeMemoryFile(dataDir, "agent-notes.md", "内容");
    setMemoryEnabled(false);

    const create = await createFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "new-category.md" }),
      }),
    );
    expect(create.status).toBe(404);

    const remove = await deleteFileRoute(
      new Request("http://localhost/api/memory/file?file=agent-notes.md", { method: "DELETE" }),
    );
    expect(remove.status).toBe(404);
    resetPiWorkRuntimeState();
  });

  it("rejects reading a file that does not exist", async () => {
    createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    const read = await readFile(new Request("http://localhost/api/memory/file?file=missing-file.md"));
    expect(read.status).toBe(404);
    resetPiWorkRuntimeState();
  });

  it("writes normally when the expected mtime matches", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    await writeMemoryFile(dataDir, "stale.md", "打开时的内容");
    const read = await readFile(new Request("http://localhost/api/memory/file?file=stale.md"));
    const { mtime } = (await json(read)) as { mtime: string };

    const write = await writeFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "stale.md", content: "我的修改", mtime }),
      }),
    );
    expect(write.status).toBe(200);

    const reread = await readFile(new Request("http://localhost/api/memory/file?file=stale.md"));
    expect((await json(reread)).content).toBe("我的修改");
    resetPiWorkRuntimeState();
  });

  it("returns 409 with the disk version when the file changed after it was opened", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    await writeMemoryFile(dataDir, "stale.md", "打开时的内容");
    const read = await readFile(new Request("http://localhost/api/memory/file?file=stale.md"));
    const { mtime } = (await json(read)) as { mtime: string };
    await writeMemoryFile(dataDir, "stale.md", "agent 改过的新内容");
    await bumpMemoryFileMtime(dataDir, "stale.md");

    const write = await writeFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "stale.md", content: "我的修改", mtime }),
      }),
    );
    expect(write.status).toBe(409);
    const body = (await json(write)) as { content?: string; mtime?: string };
    expect(body.content).toBe("agent 改过的新内容");
    expect(typeof body.mtime).toBe("string");
    expect(body.mtime).not.toBe(mtime);
    resetPiWorkRuntimeState();
  });

  it("overwrites the disk version when force is set despite an mtime conflict", async () => {
    const { dataDir } = createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    await writeMemoryFile(dataDir, "stale.md", "打开时的内容");
    const read = await readFile(new Request("http://localhost/api/memory/file?file=stale.md"));
    const { mtime } = (await json(read)) as { mtime: string };
    await writeMemoryFile(dataDir, "stale.md", "agent 改过的新内容");
    await bumpMemoryFileMtime(dataDir, "stale.md");

    const write = await writeFileRoute(
      new Request("http://localhost/api/memory/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "stale.md", content: "我的修改", mtime, force: true }),
      }),
    );
    expect(write.status).toBe(200);

    const reread = await readFile(new Request("http://localhost/api/memory/file?file=stale.md"));
    expect((await json(reread)).content).toBe("我的修改");
    resetPiWorkRuntimeState();
  });
});
