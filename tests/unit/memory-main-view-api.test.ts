import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as listFiles } from "@/app/api/memory/files/route";
import { GET as readFile, PUT as writeFileRoute } from "@/app/api/memory/file/route";
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

  it("rejects reading a file that does not exist", async () => {
    createSandbox("pi-work-memory-main-view-api-");
    setMemoryEnabled(true);
    const read = await readFile(new Request("http://localhost/api/memory/file?file=missing-file.md"));
    expect(read.status).toBe(404);
    resetPiWorkRuntimeState();
  });
});
