import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const VENDORED_PREFIXES = ["public/", "volumes/"];

const TOOL_DIRECTIVE =
  /^(\/\/\s*(eslint-(disable|enable)\b|@ts-(ignore|expect-error|nocheck|check)\b|@vitest-environment\b)|\/\*\*?\s*@type\b)/;

const CSS_TEMPLATE_KINDS = new Set([
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

const OPAQUE_STRING_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
]);

type Comment = { line: number; text: string };

function scriptKindOf(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function offsetComments(source: string, text: string, base: number): Comment[] {
  const comments: Comment[] = [];
  const pattern = /\/\*[\s\S]*?\*\//g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    comments.push({ line: lineOf(source, base + match.index), text: match[0] });
  }
  return comments;
}

function blankOpaqueStrings(source: string, kind: ts.ScriptKind): string {
  const file = ts.createSourceFile("source", source, ts.ScriptTarget.Latest, true, kind);
  const chars = [...source];
  const blank = (start: number, end: number) => {
    for (let i = start; i < end; i += 1) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  };
  const visit = (node: ts.Node) => {
    if (OPAQUE_STRING_KINDS.has(node.kind)) blank(node.getStart(file), node.end);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return chars.join("");
}

function syntaxCommentsIn(source: string, kind: ts.ScriptKind): Comment[] {
  const bare = blankOpaqueStrings(source, kind);
  const comments: Comment[] = [];
  const pattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  for (let match = pattern.exec(bare); match; match = pattern.exec(bare)) {
    comments.push({ line: lineOf(bare, match.index), text: source.slice(match.index, match.index + match[0].length) });
  }
  return comments;
}

function templateCssCommentsIn(source: string, kind: ts.ScriptKind): Comment[] {
  const file = ts.createSourceFile("source", source, ts.ScriptTarget.Latest, true, kind);
  const comments: Comment[] = [];
  const visit = (node: ts.Node) => {
    if (CSS_TEMPLATE_KINDS.has(node.kind)) {
      const start = node.getStart(file);
      const raw = source.slice(start, node.end);
      if (/\{[\s\S]*;/.test(raw)) comments.push(...offsetComments(source, raw, start));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return comments;
}

function scriptCommentsIn(source: string, kind: ts.ScriptKind): Comment[] {
  return [...syntaxCommentsIn(source, kind), ...templateCssCommentsIn(source, kind)];
}

function styleCommentsIn(source: string): Comment[] {
  return offsetComments(source, source, 0);
}

function commentsIn(file: string, source: string): Comment[] {
  if (file.endsWith(".css")) return styleCommentsIn(source);
  return scriptCommentsIn(source, scriptKindOf(file));
}

function productSources(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" }).split("\0");
  return listed.filter(
    (file) =>
      file.length > 0 &&
      (SCRIPT_EXTENSIONS.has(path.extname(file)) || file.endsWith(".css")) &&
      !VENDORED_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

describe("scriptCommentsIn", () => {
  it("ignores comment syntax inside strings, templates, regexes and JSX text", () => {
    const source = [
      'const url = `http://${host}/api?x=1`;',
      'const path = "//not-a-comment";',
      "const re = /[/][*]/;",
      'const glob = "./pages/**/*.{js,ts,jsx,tsx,mdx}";',
      "export function View() {",
      "  return <div>http://example.com/a</div>;",
      "}",
    ].join("\n");

    expect(scriptCommentsIn(source, ts.ScriptKind.TSX)).toEqual([]);
  });

  it("reports line and block comments with their line number", () => {
    const source = ["const a = 1;", "// why a", "/* why b", "   why c */", "const b = 2;"].join("\n");

    expect(scriptCommentsIn(source, ts.ScriptKind.TS)).toEqual([
      { line: 2, text: "// why a" },
      { line: 3, text: "/* why b\n   why c */" },
    ]);
  });

  it("reports block comments inside CSS held in a template literal", () => {
    const source = [
      "export const STYLES = `",
      "  .card {",
      "    /* checked fades the ring out */",
      "    border-color: transparent;",
      "  }",
      "`;",
    ].join("\n");

    expect(scriptCommentsIn(source, ts.ScriptKind.TS)).toEqual([
      { line: 3, text: "/* checked fades the ring out */" },
    ]);
  });
});

describe("styleCommentsIn", () => {
  it("reports every block comment", () => {
    const source = [":root {", "  /* why */", "  --gap: 10px;", "}"].join("\n");

    expect(styleCommentsIn(source)).toEqual([{ line: 2, text: "/* why */" }]);
  });
});

describe("product sources", () => {
  it("carry no comments beyond tool directives", () => {
    const offenders: string[] = [];

    for (const file of productSources()) {
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      for (const comment of commentsIn(file, source)) {
        if (!TOOL_DIRECTIVE.test(comment.text)) offenders.push(`${file}:${comment.line} ${comment.text}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
