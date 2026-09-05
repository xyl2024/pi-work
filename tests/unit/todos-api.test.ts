import { afterAll, describe, expect, it } from "vitest";
import { api, uniqueId } from "./helpers";

/**
 * Business-level CRUD roundtrip against /api/todos on the isolated instance.
 * Every todo created here carries a unique marker tag so cleanup can find it
 * even if an assertion fails midway.
 */
/** API returns tags as { name, color? } objects; get their names. */
function tagNames(t: { tags: Array<{ name: string }> }): string[] {
  return t.tags.map((tag) => tag.name);
}

const marker = uniqueId("t");
const createdIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const id of createdIds) {
    await api(`/api/todos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  // marker tag may linger on todos that failed mid-test — remove it globally.
  await api("/api/tags", { method: "DELETE", body: JSON.stringify({ tag: marker }) });
}

afterAll(cleanup);

describe("todos api", () => {
  it("creates, lists, updates, then deletes a todo", async () => {
    // 1. POST — create
    const create = await api("/api/todos", {
      method: "POST",
      body: JSON.stringify({
        title: `测试待办 ${marker}`,
        description: "created by tests/unit/todos-api.test.ts",
        tags: [marker],
        priority: "high",
        deadline: Date.now() + 86_400_000,
      }),
    });
    expect(create.status).toBe(200);
    const todo = create.body.todo as {
      id: string;
      title: string;
      description?: string;
      done: boolean;
      tags: Array<{ name: string }>;
      priority?: string;
      completedAt?: number;
    };
    expect(todo.id).toBeTypeOf("string");
    expect(todo.title).toBe(`测试待办 ${marker}`);
    expect(todo.done).toBe(false);
    expect(tagNames(todo)).toContain(marker);
    expect(todo.priority).toBe("high");
    createdIds.push(todo.id);

    // 2. GET — visible in the list
    const list = await api("/api/todos");
    expect(list.status).toBe(200);
    const found = (list.body.todos as Array<typeof todo>).find((t) => t.id === todo.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe(`测试待办 ${marker}`);

    // 3. PATCH — mark done (requires a completionNote) and change priority
    const patch = await api("/api/todos", {
      method: "PATCH",
      body: JSON.stringify({ id: todo.id, done: true, completionNote: "已完成", priority: "low" }),
    });
    expect(patch.status).toBe(200);
    const updated = patch.body.todo as typeof todo;
    expect(updated.done).toBe(true);
    expect(updated.priority).toBe("low");
    expect(updated.completedAt).toBeTypeOf("number");

    // 4. DELETE — then confirm gone
    const del = await api(`/api/todos?id=${encodeURIComponent(todo.id)}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    const listAfter = await api("/api/todos");
    const gone = (listAfter.body.todos as Array<{ id: string }>).find((t) => t.id === todo.id);
    expect(gone).toBeUndefined();
  });

  it("rejects invalid input with 400", async () => {
    // missing title
    const noTitle = await api("/api/todos", { method: "POST", body: JSON.stringify({}) });
    expect(noTitle.status).toBe(400);

    // empty title
    const emptyTitle = await api("/api/todos", {
      method: "POST",
      body: JSON.stringify({ title: "" }),
    });
    expect(emptyTitle.status).toBe(400);

    // PATCH without id
    const noId = await api("/api/todos", { method: "PATCH", body: JSON.stringify({ done: true }) });
    expect(noId.status).toBe(400);
  });

  it("rejects marking done without a completionNote", async () => {
    const res = await api("/api/todos", {
      method: "POST",
      body: JSON.stringify({ title: `无备注 ${marker}` }),
    });
    expect(res.status).toBe(200);
    const id = (res.body.todo as { id: string }).id;
    createdIds.push(id);

    const patch = await api("/api/todos", {
      method: "PATCH",
      body: JSON.stringify({ id, done: true }),
    });
    expect(patch.status).toBe(400);
    expect(String(patch.body.error)).toContain("completionNote");
  });

  it("returns 404 for unknown todo id", async () => {
    const patch = await api("/api/todos", {
      method: "PATCH",
      body: JSON.stringify({ id: "no-such-id", done: true }),
    });
    expect(patch.status).toBe(404);

    const del = await api("/api/todos?id=no-such-id", { method: "DELETE" });
    expect(del.status).toBe(404);
  });

  it("renames and deletes a tag across todos", async () => {
    // seed two todos sharing the marker tag
    const ids: string[] = [];
    for (const title of [`标签 A ${marker}`, `标签 B ${marker}`]) {
      const res = await api("/api/todos", {
        method: "POST",
        body: JSON.stringify({ title, tags: [marker] }),
      });
      expect(res.status).toBe(200);
      ids.push((res.body.todo as { id: string }).id);
      createdIds.push(ids[ids.length - 1]);
    }

    const renamed = uniqueId("renamed");
    const rename = await api("/api/tags", {
      method: "PATCH",
      body: JSON.stringify({ from: marker, to: renamed }),
    });
    expect(rename.status).toBe(200);
    expect(rename.body.affected).toBeGreaterThanOrEqual(2);

    // todos now carry the renamed tag, not the old one
    const list = await api("/api/todos");
    const todos = list.body.todos as Array<{ id: string; tags: Array<{ name: string }> }>;
    for (const id of ids) {
      const t = todos.find((x) => x.id === id);
      expect(tagNames(t!)).toContain(renamed);
      expect(tagNames(t!)).not.toContain(marker);
    }

    // delete the renamed tag everywhere
    const del = await api("/api/tags", {
      method: "DELETE",
      body: JSON.stringify({ tag: renamed }),
    });
    expect(del.status).toBe(200);
    const listAfter = await api("/api/todos");
    const todosAfter = listAfter.body.todos as Array<{ id: string; tags: Array<{ name: string }> }>;
    for (const id of ids) {
      const t = todosAfter.find((x) => x.id === id);
      expect(tagNames(t!)).not.toContain(renamed);
    }
  });
});
