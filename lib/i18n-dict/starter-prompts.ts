// New-session starter prompt chips — title / description / inserted text.
// "Hi, {name}..." welcome line + workspace activity live in sessions.ts.

export const starterPrompts = {
  "Explore this codebase": "梳理这个项目",
  "Understand the project structure and how it fits together": "了解项目结构、关键模块与它们的关系",
  "Walk me through this codebase: overall architecture, key modules, entry points, and how they fit together.": "帮我梳理一下这个项目的整体架构：核心模块、入口文件，以及它们之间的关系。",
  "Review my code": "Review 我的代码",
  "Find bugs, smells, and improvements": "找出潜在 bug、坏味道并给出改进建议",
  "Review the code for bugs, code smells, and improvements. Point out concrete issues with file paths and line numbers.": "帮我 Review 代码，找出潜在 bug、坏味道并给出改进建议，尽量指出具体文件和行号。",
  "Help me debug": "帮我调试问题",
  "Reproduce, isolate, and fix a bug": "复现、定位根因并修复",
  "Help me debug this issue: reproduce it, find the root cause, and fix it.": "帮我调试这个问题：先复现它，再定位根因，最后修复。",
  "Write tests": "帮我写测试",
  "Add unit tests for a module": "为某个模块补充单元测试",
  "Write unit tests for this module, covering the main paths and edge cases.": "为这个模块编写单元测试，覆盖主要路径和边界情况。",
  "Optimize performance": "帮我优化性能",
  "Profile and speed up slow code": "定位性能瓶颈并优化",
  "Profile this code, find the performance bottlenecks, and suggest concrete optimizations.": "分析这段代码的性能瓶颈，并给出具体的优化方案。",
  "Document this project": "生成项目文档",
  "Generate a structured wiki from the source": "从源码生成结构化的 Wiki 文档",
  "Generate structured project documentation (a wiki) from the source code.": "根据源码生成结构化的项目文档（Wiki）。",
} as const;
