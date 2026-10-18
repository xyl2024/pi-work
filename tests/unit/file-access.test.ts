import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The public contract of `lib/server/file-access.ts` — specifically that the
 * cache work (shared in-flight scan, longer TTL, invalidation) does not change
 * the authorisation answer. Driven at the module level against a temp data /
 * agent root, so the real `~/.pi-work` and `~/.pi` are never touched.
 *
 * Deliberately does NOT assert how many scans happen (tests/README.md forbids
 * asserting internal call counts) — only that the same path gets the same
 * answer, and that invalidation still takes effect.
 */

const root = mkdtempSync(join(tmpdir(), "pi-work-file-access-"));
const agentDir = join(root, "agent");
const workspace = join(root, "workspace");

let getAllowedRoots: () => Promise<Set<string>>;
let invalidateAllowedRootsCache: () => void;
let isPathAllowed: (target: string, roots: Set<string>) => boolean;

beforeAll(async () => {
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  process.env.PI_WORK_DATA_DIR = root;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const mod = await import("@/lib/server/file-access");
  getAllowedRoots = mod.getAllowedRoots;
  invalidateAllowedRootsCache = mod.invalidateAllowedRootsCache;
  isPathAllowed = mod.isPathAllowed;
});

beforeEach(() => {
  globalThis.__piCreatedSpaceRoots = undefined;
  invalidateAllowedRootsCache();
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("file-access: allowed-roots contract", () => {
  it("allows a path under a known root and rejects one outside", async () => {
    globalThis.__piCreatedSpaceRoots = new Set([join(root, "project")]);
    const roots = await getAllowedRoots();

    expect(isPathAllowed(join(root, "project", "a", "b.txt"), roots)).toBe(true);
    expect(isPathAllowed(join(root, "elsewhere", "b.txt"), roots)).toBe(false);
    expect(isPathAllowed("/etc/passwd", roots)).toBe(false);
  });

  it("sees a newly created root after invalidation", async () => {
    const before = await getAllowedRoots();
    expect(isPathAllowed(join(root, "later"), before)).toBe(false);

    globalThis.__piCreatedSpaceRoots = new Set([join(root, "later")]);
    invalidateAllowedRootsCache();

    const after = await getAllowedRoots();
    expect(isPathAllowed(join(root, "later", "x"), after)).toBe(true);
  });

  it("gives concurrent callers one consistent answer", async () => {
    globalThis.__piCreatedSpaceRoots = new Set([join(root, "proj")]);
    const [a, b] = await Promise.all([getAllowedRoots(), getAllowedRoots()]);

    expect(isPathAllowed(join(root, "proj", "x"), a)).toBe(true);
    expect(isPathAllowed(join(root, "proj", "x"), b)).toBe(true);
    expect(isPathAllowed(join(root, "nope", "x"), a)).toBe(false);
    expect(isPathAllowed(join(root, "nope", "x"), b)).toBe(false);
  });
});
