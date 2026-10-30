export interface FileLanguageInfo {
	id: string;
	label: string;
}

const FILENAME_MAP: Record<string, FileLanguageInfo> = {
	dockerfile: { id: "dockerfile", label: "Dockerfile" },
	makefile: { id: "makefile", label: "Makefile" },
	gnumakefile: { id: "makefile", label: "Makefile" },
};

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
	toml: { id: "ini", label: "TOML" },
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

export function getFileLanguage(filePath: string): FileLanguageInfo {
	const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
	const lowerBase = base.toLowerCase();

	if (lowerBase === "dockerfile" || lowerBase.startsWith("dockerfile.")) {
		return FILENAME_MAP.dockerfile!;
	}
	if (lowerBase === "makefile" || lowerBase === "gnumakefile") {
		return FILENAME_MAP.makefile!;
	}
	if (lowerBase === ".env" || lowerBase.startsWith(".env.")) {
		return { id: "bash", label: "Env" };
	}

	const dot = lowerBase.lastIndexOf(".");
	const ext = dot >= 0 ? lowerBase.slice(dot + 1) : "";
	if (ext && EXTENSION_MAP[ext]) {
		return EXTENSION_MAP[ext];
	}

	return { id: "text", label: "Plain Text" };
}