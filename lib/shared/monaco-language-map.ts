// Shared file-extension → language ID map. Used by:
//   - server `lib/server/files/handler.ts` to label the `language` field
//     returned by the files API
//   - client `components/files/file-viewer/MonacoViewer.tsx` to choose
//     which Monaco language to register / tokenize a file with
//
// The IDs are deliberately shared between Prism (used by react-syntax-
// highlighter for chat message code blocks) and Monaco so we don't have
// to maintain two parallel maps; Monaco lumps tsx/jsx under "typescript"
// and jsx under "javascript", which lines up with the existing map.
//
// Add new entries here, NOT in handler.ts — both consumers import from
// this module. If you need a language Monaco doesn't have built-in,
// register it via `useMonacoLoader.ts` and add it to `preinstalled`
// there, and add an entry here keyed by file extension.

export interface FileLanguageInfo {
	/** Monaco / Prism language ID. Falls back to "plaintext". */
	id: string;
	/** Human-readable label shown in the status bar. */
	label: string;
}

/** Filename → language lookup, special cases first. */
const FILENAME_MAP: Record<string, FileLanguageInfo> = {
	dockerfile: { id: "dockerfile", label: "Dockerfile" },
	makefile: { id: "makefile", label: "Makefile" },
	gnumakefile: { id: "makefile", label: "Makefile" },
};

/** Extension → language lookup, lower-cased. */
const EXTENSION_MAP: Record<string, FileLanguageInfo> = {
	ts: { id: "typescript", label: "TypeScript" },
	tsx: { id: "typescript", label: "TypeScript" },
	cts: { id: "typescript", label: "TypeScript" },
	mts: { id: "typescript", label: "TypeScript" },
	js: { id: "javascript", label: "JavaScript" },
	jsx: { id: "javascript", label: "JavaScript" },
	mjs: { id: "javascript", label: "JavaScript" },
	cjs: { id: "javascript", label: "JavaScript" },
	py: { id: "python", label: "Python" },
	rb: { id: "ruby", label: "Ruby" },
	go: { id: "go", label: "Go" },
	rs: { id: "rust", label: "Rust" },
	java: { id: "java", label: "Java" },
	kt: { id: "kotlin", label: "Kotlin" },
	kts: { id: "kotlin", label: "Kotlin" },
	swift: { id: "swift", label: "Swift" },
	c: { id: "c", label: "C" },
	h: { id: "c", label: "C" },
	cpp: { id: "cpp", label: "C++" },
	cc: { id: "cpp", label: "C++" },
	cxx: { id: "cpp", label: "C++" },
	hpp: { id: "cpp", label: "C++" },
	hxx: { id: "cpp", label: "C++" },
	cs: { id: "csharp", label: "C#" },
	html: { id: "html", label: "HTML" },
	htm: { id: "html", label: "HTML" },
	css: { id: "css", label: "CSS" },
	scss: { id: "scss", label: "SCSS" },
	sass: { id: "scss", label: "Sass" },
	less: { id: "less", label: "Less" },
	json: { id: "json", label: "JSON" },
	jsonc: { id: "json", label: "JSON" },
	jsonl: { id: "json", label: "JSON" },
	ndjson: { id: "json", label: "JSON" },
	yaml: { id: "yaml", label: "YAML" },
	yml: { id: "yaml", label: "YAML" },
	toml: { id: "ini", label: "TOML" }, // Monaco has no toml; ini is close
	ini: { id: "ini", label: "INI" },
	xml: { id: "xml", label: "XML" },
	svg: { id: "xml", label: "SVG" },
	md: { id: "markdown", label: "Markdown" },
	mdx: { id: "markdown", label: "MDX" },
	sh: { id: "bash", label: "Shell" },
	bash: { id: "bash", label: "Bash" },
	zsh: { id: "bash", label: "Zsh" },
	fish: { id: "bash", label: "Fish" },
	ps1: { id: "powershell", label: "PowerShell" },
	sql: { id: "sql", label: "SQL" },
	graphql: { id: "graphql", label: "GraphQL" },
	gql: { id: "graphql", label: "GraphQL" },
	dockerignore: { id: "bash", label: "Dockerignore" },
	gitignore: { id: "bash", label: "Gitignore" },
	env: { id: "bash", label: "Env" },
	editorconfig: { id: "ini", label: "EditorConfig" },
	tf: { id: "ini", label: "Terraform" },
	hcl: { id: "ini", label: "HCL" },
	txt: { id: "text", label: "Text" },
	log: { id: "text", label: "Log" },
};

/** Monaco languages we ask the loader to register up-front (preinstalled
 *  in the lazy chunk). Anything not in this set still loads on demand
 *  via `monaco.languages.register({ id })` if a user opens such a file;
 *  the loader is the only place this set needs editing.
 *
 *  IDs match what we return from the files API (see
 *  lib/shared/monaco-language-map.ts) — Monaco accepts both "bash" and
 *  "shell" as the shellscript language, but we stick with "bash" so the
 *  same identifier works in Prism's react-syntax-highlighter (used by
 *  CodeBlock in chat messages). */
export const PREINSTALLED_MONACO_LANGUAGES = new Set<string>([
	"typescript",
	"javascript",
	"json",
	"css",
	"scss",
	"less",
	"html",
	"markdown",
	"python",
	"yaml",
	"bash",
	"sql",
	"go",
	"rust",
	"java",
	"c",
	"cpp",
]);

/**
 * Resolve a file path to its Monaco language info.
 *
 * Order of checks (most → least specific):
 *   1. Special full filenames (Dockerfile, Makefile, .env*, etc.)
 *   2. File extension (lower-cased, including the last `.`-segment)
 *   3. Fallback to plaintext
 */
export function getFileLanguage(filePath: string): FileLanguageInfo {
	const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
	const lowerBase = base.toLowerCase();

	// Special filenames
	if (lowerBase === "dockerfile" || lowerBase.startsWith("dockerfile.")) {
		return FILENAME_MAP.dockerfile!;
	}
	if (lowerBase === "makefile" || lowerBase === "gnumakefile") {
		return FILENAME_MAP.makefile!;
	}
	if (lowerBase === ".env" || lowerBase.startsWith(".env.")) {
		return { id: "bash", label: "Env" };
	}

	// Extension
	const dot = lowerBase.lastIndexOf(".");
	const ext = dot >= 0 ? lowerBase.slice(dot + 1) : "";
	if (ext && EXTENSION_MAP[ext]) {
		return EXTENSION_MAP[ext];
	}

	// Fallback
	return { id: "text", label: "Plain Text" };
}

/** Convenience: just the language ID. */
export function getFileLanguageId(filePath: string): string {
	return getFileLanguage(filePath).id;
}