/**
 * Interface tests for the file explorer's create/upload API surface:
 *
 *   POST /api/files/<dir>?type=create|mkdir   body {name}
 *   POST /api/files/<dir>?type=upload         multipart (file + path pairs)
 *
 * Runs against the isolated instance (see tests/global-setup.ts). All
 * fixtures live inside a uniquely-named scratch dir under the default
 * workspace root and are cleaned up, so reruns are idempotent.
 */
import { describe, expect, it } from "vitest";
import { TEST_BASE_URL } from "../config";
import { uniqueId } from "./helpers";

const enc = (p: string) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

async function createEntry(cwd: string, type: "create" | "mkdir", name: string) {
  return fetch(`${TEST_BASE_URL}/api/files/${enc(cwd)}?type=${type}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

async function listEntries(dir: string): Promise<{ name: string; isDir: boolean }[]> {
  const res = await fetch(`${TEST_BASE_URL}/api/files/${enc(dir)}?type=list`);
  expect(res.status).toBe(200);
  const data = (await res.json()) as { entries?: { name: string; isDir: boolean }[] };
  return data.entries ?? [];
}

async function deleteEntry(dir: string, name: string) {
  await fetch(`${TEST_BASE_URL}/api/files/${enc(dir)}/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

describe("file explorer create/upload api", () => {
  it("creates a file and a folder, uploads files (incl. nested), skips existing, rejects traversal", async () => {
    // Obtain an allowed workspace root (creates pi-cwd-default).
    const cwdRes = await fetch(`${TEST_BASE_URL}/api/default-cwd`, { method: "POST" });
    expect(cwdRes.status).toBe(200);
    const { cwd } = (await cwdRes.json()) as { cwd: string };
    expect(cwd).toBeTruthy();

    // Unique scratch dir so reruns never collide with leftover state.
    const scratch = uniqueId("fe-scratch");
    const mkdirRes = await createEntry(cwd, "mkdir", scratch);
    expect(mkdirRes.status).toBe(200);
    const scratchDir = `${cwd}/${scratch}`;

    try {
      const fileName = `${uniqueId("file")}.txt`;
      const dirName = uniqueId("inner");

      // -- create file --
      const createRes = await createEntry(scratchDir, "create", fileName);
      expect(createRes.status).toBe(200);

      // Duplicate create → 409
      const dupRes = await createEntry(scratchDir, "create", fileName);
      expect(dupRes.status).toBe(409);

      // Invalid name → 400
      const badRes = await createEntry(scratchDir, "create", "../escape.txt");
      expect(badRes.status).toBe(400);

      // -- create folder --
      const mkdirInnerRes = await createEntry(scratchDir, "mkdir", dirName);
      expect(mkdirInnerRes.status).toBe(200);

      // -- upload: one top-level file + one nested in dirName --
      const form = new FormData();
      form.append("file", new Blob(["hello"]), "a.txt");
      form.append("path", "a.txt");
      form.append("file", new Blob(["nested"]), "b.txt");
      form.append("path", `${dirName}/b.txt`);
      form.append("file", new Blob(["evil"]), "evil.txt");
      form.append("path", "../evil.txt");
      const uploadRes = await fetch(`${TEST_BASE_URL}/api/files/${enc(scratchDir)}?type=upload`, {
        method: "POST",
        body: form,
      });
      expect(uploadRes.status).toBe(200);
      const uploadData = (await uploadRes.json()) as {
        uploaded: number;
        skipped: number;
        failed: { path: string; error: string }[];
      };
      expect(uploadData.uploaded).toBe(2);
      expect(uploadData.skipped).toBe(0);
      expect(uploadData.failed).toHaveLength(1);
      expect(uploadData.failed[0].path).toBe("../evil.txt");

      // Traversal must not have materialized anywhere.
      const scratchEntries = await listEntries(scratchDir);
      expect(scratchEntries.map((e) => e.name).sort()).toEqual([dirName, "a.txt", fileName].sort());

      // Nested file landed inside dirName.
      const dirEntries = await listEntries(`${scratchDir}/${dirName}`);
      expect(dirEntries.map((e) => e.name)).toContain("b.txt");

      // -- re-upload → skipped, nothing overwritten --
      const form2 = new FormData();
      form2.append("file", new Blob(["overwritten?"]), "a.txt");
      form2.append("path", "a.txt");
      const reRes = await fetch(`${TEST_BASE_URL}/api/files/${enc(scratchDir)}?type=upload`, {
        method: "POST",
        body: form2,
      });
      expect(reRes.status).toBe(200);
      const reData = (await reRes.json()) as { uploaded: number; skipped: number };
      expect(reData.uploaded).toBe(0);
      expect(reData.skipped).toBe(1);

      // Original content preserved.
      const readRes = await fetch(
        `${TEST_BASE_URL}/api/files/${enc(scratchDir)}/a.txt?type=read`,
      );
      expect(readRes.status).toBe(200);
      const readData = (await readRes.json()) as { content: string };
      expect(readData.content).toBe("hello");

      // -- upload into a non-directory → 400 --
      const badUpload = await fetch(
        `${TEST_BASE_URL}/api/files/${enc(scratchDir)}/a.txt?type=upload`,
        { method: "POST", body: new FormData() },
      );
      expect(badUpload.status).toBe(400);
    } finally {
      // -- cleanup: wipe the scratch dir (files first, then the dir) --
      const entries = await listEntries(scratchDir);
      for (const e of entries) {
        if (e.isDir) {
          const inner = await listEntries(`${scratchDir}/${e.name}`);
          for (const f of inner) await deleteEntry(`${scratchDir}/${e.name}`, f.name);
        }
        await deleteEntry(scratchDir, e.name);
      }
      await deleteEntry(cwd, scratch);
      const after = await listEntries(cwd);
      expect(after.some((x) => x.name === scratch)).toBe(false);
    }
  });
});
