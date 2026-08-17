import { mkdir, unlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { basename, isAbsolute, join, resolve, sep } from "path";
import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

function cleanPromptName(value: string): string {
  return value.trim().replace(/^\/+/, "").replace(/\.md$/i, "");
}

function nameFromFilePath(filePath: string): string {
  return basename(filePath).replace(/\.md$/i, "");
}

function isValidPromptName(name: string): boolean {
  return Boolean(name) && !name.startsWith(".") && !/[\/\\\s\x00-\x1F\x7F]/.test(name);
}

function promptFileContent(description: string, argumentHint: string, content: string): string {
  const frontmatter: string[] = [];
  if (description.trim()) frontmatter.push(`description: ${JSON.stringify(description.trim())}`);
  if (argumentHint.trim()) frontmatter.push(`argument-hint: ${JSON.stringify(argumentHint.trim())}`);

  const body = content.endsWith("\n") ? content : `${content}\n`;
  if (frontmatter.length === 0) return body;
  return `---\n${frontmatter.join("\n")}\n---\n${body}`;
}

function isUnderPath(target: string, root: string): boolean {
  const normRoot = resolve(root);
  if (target === normRoot) return true;
  const prefix = normRoot.endsWith(sep) ? normRoot : `${normRoot}${sep}`;
  return target.startsWith(prefix);
}

// A prompt file is editable only when it lives in either:
//   - the global prompts dir (getAgentDir()/prompts), or
//   - the project prompts dir for the cwd the dialog was opened with (<cwd>/.pi/prompts)
// Bundled / package-shipped prompts (under node_modules, package.json pi.prompts, etc.)
// are read-only and rejected.
function editablePromptDir(cwd: string): { global: string; project: string } {
  return {
    global: join(getAgentDir(), "prompts"),
    project: join(cwd, ".pi", "prompts"),
  };
}

function isEditablePromptPath(filePath: string, cwd: string): boolean {
  if (!isAbsolute(filePath)) return false;
  if (!filePath.endsWith(".md")) return false;
  const { global, project } = editablePromptDir(cwd);
  const resolved = resolve(filePath);
  return isUnderPath(resolved, global) || isUnderPath(resolved, project);
}

// GET /api/prompts?cwd=<path>
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  if (!existsSync(cwd)) return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });

  try {
    // This endpoint only needs prompt templates. Do not execute user extensions here:
    // an extension factory may perform arbitrary startup work (for example, a network
    // probe) and would make this read-only request depend on unrelated services.
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const { prompts, diagnostics } = loader.getPrompts();
    return NextResponse.json({ prompts, diagnostics });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/prompts - create a prompt template in ~/.pi/agent/prompts or <cwd>/.pi/prompts
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      cwd?: string;
      scope?: "global" | "project";
      name?: string;
      description?: string;
      argumentHint?: string;
      content?: string;
    };

    const cwd = body.cwd;
    const scope = body.scope ?? "global";
    const name = cleanPromptName(body.name ?? "");
    const content = body.content ?? "";

    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!existsSync(cwd)) return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    if (!isValidPromptName(name)) {
      return NextResponse.json({ error: "Prompt name must not contain whitespace or path separators" }, { status: 400 });
    }
    if (!content.trim()) return NextResponse.json({ error: "content required" }, { status: 400 });

    const dir = scope === "project"
      ? join(cwd, ".pi", "prompts")
      : join(getAgentDir(), "prompts");
    const filePath = join(dir, `${name}.md`);

    if (existsSync(filePath)) return NextResponse.json({ error: "prompt already exists" }, { status: 409 });

    await mkdir(dir, { recursive: true });
    await writeFile(filePath, promptFileContent(body.description ?? "", body.argumentHint ?? "", content), "utf8");

    return NextResponse.json({ success: true, filePath });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PUT /api/prompts - edit an existing prompt template in place (by filePath)
export async function PUT(req: Request) {
  try {
    const body = await req.json() as {
      cwd?: string;
      filePath?: string;
      name?: string;
      description?: string;
      argumentHint?: string;
      content?: string;
    };

    const cwd = body.cwd;
    const filePath = body.filePath;
    const name = cleanPromptName(body.name ?? "");
    const content = body.content ?? "";

    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!existsSync(cwd)) return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    if (!isEditablePromptPath(filePath, cwd)) {
      return NextResponse.json(
        { error: "Only user or project prompts are editable" },
        { status: 403 },
      );
    }
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "prompt no longer exists" }, { status: 404 });
    }
    if (!isValidPromptName(name)) {
      return NextResponse.json({ error: "Prompt name must not contain whitespace or path separators" }, { status: 400 });
    }
    if (!content.trim()) return NextResponse.json({ error: "content required" }, { status: 400 });

    // Preserve current on-disk name when caller doesn't supply one.
    const currentName = nameFromFilePath(filePath);
    const finalName = name || currentName;
    if (finalName !== currentName) {
      return NextResponse.json(
        { error: "Renaming prompts is not supported yet" },
        { status: 400 },
      );
    }

    await writeFile(filePath, promptFileContent(body.description ?? "", body.argumentHint ?? "", content), "utf8");

    return NextResponse.json({ success: true, filePath });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/prompts - delete a prompt template by filePath
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as {
      cwd?: string;
      filePath?: string;
    };

    const cwd = body.cwd;
    const filePath = body.filePath;

    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!existsSync(cwd)) return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    if (!isEditablePromptPath(filePath, cwd)) {
      return NextResponse.json(
        { error: "Only user or project prompts are deletable" },
        { status: 403 },
      );
    }
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "prompt no longer exists" }, { status: 404 });
    }

    await unlink(filePath);

    return NextResponse.json({ success: true, filePath });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
