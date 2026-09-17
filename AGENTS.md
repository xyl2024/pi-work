# AGENTS.md

## 项目定位

Pi Work 是 pi coding agent 的 Next.js Web UI，负责会话浏览、实时对话、文件操作和一组辅助面板。技术栈为 TypeScript、React 19、Next.js App Router、Tailwind CSS、SQLite；要求 Node.js 22+。`electron-shell/` 是可选的 Electron 外壳，不是核心 Web 应用。

## 主要功能边界

- **会话与 Agent**：多会话工作区和标签页、SSE 流式事件、分支树导航、上下文压缩、模型/思考级别/工具选择、会话搜索/重命名/删除/导出/自动命名。
- **项目工作区**：按 cwd 浏览和搜索文件，编辑、重命名、删除和查看文本、代码、Diff、图片、音频、视频、PDF、SVG、Mermaid、ECharts；支持 Git Diff 和独立终端。
- **辅助面板**：右栏面板为 Context、翻译、RSS、GitHub Trending、Git Diff、收藏、Token 审计、LLM API 审计、工具调用统计、Conversation Tree、BTW、看板、笔记；另有独立的终端面板与定时任务模态。
- **配置与集成**：模型/API Key/OAuth、Prompt、Skill、危险命令确认、自定义 Agent 工具、右侧按钮、音效和界面设置；另有 Inbox、微信登录/收发消息及 Grokbot 功能。

## 目录与架构

```
pi-work/
├── app/                # Next.js App Router 入口；app/api/**/route.ts 只做适配，业务逻辑放 lib/server
│   └── api/            # 按领域的路由目录：agent、agent-settings、append-system、auth、btw、channels、
│                       #   create-space、cwd-aliases/-icons/-tools、default-cwd、exchange-rate、favorites、
│                       #   file-mentions、files、git、github-trending、home、inbox、kanban、llm-audit、models、
│                       #   models-config、notes、notes-file、profile、prompts、rss、scheduled-tasks、
│                       #   sessions、settings、skills、slash-commands、status-bar、subagents、terminal、
│                       #   token-audit、tools-market、translate、workspaces
├── components/         # React UI，按产品功能拆分
│   ├── app-shell/      # 应用外壳与命令面板
│   ├── chat/           # 聊天、输入、消息渲染、模型/思考级别/工具选择、权限确认、Ask User Questions
│   ├── sessions/       # 会话侧栏、标签页、搜索、会话库、多 cwd、收藏、Conversation Tree
│   ├── files/          # 文件浏览、Git 状态与查看器（file-viewer/ 支持文本/代码、图片、音频、视频、PDF）
│   ├── panels/         # 右侧面板 body（Context、Translate、RSS、GitHub Trending、Git Diff 含 Git Log、
│   │                   #   Favorites、Tokens、LLM Audit、Tool Calls、Conversation Tree、BTW、Kanban、
│   │                   #   Notes）+ TerminalPanel；right-bar/ 是按钮列，desc.tsx 注册描述符
│   ├── settings/       # 设置弹窗与各配置区块（模型、Prompt、Skill、Profile、重试、Append System、
│   │                   #   自定义工具、文件预览、右侧按钮、音效）
│   ├── markdown-editor/ # 共用 Markdown 编辑器（CodeMirror + 工具栏 + 快捷键），笔记面板与计划详情弹窗共用
│   ├── renderers/      # 消息中的代码块、ECharts、Mermaid、SVG 与图片渲染器
│   ├── ui/             # 公共 UI 原语、图标与动画图标
│   └── inbox/ rss/ scheduler/ kanban/ grokbot/ tools-market/ channels/ auth/ effects/
│                       # 消息中心、RSS、定时任务、看板、Grokbot、工具市场、频道、登录、庆祝动画
├── hooks/              # 客户端 hooks、store 与会话状态；useAgentSession/ 只从 index.ts 导出，
│                       # 内部文件不是稳定 API
├── lib/
│   ├── client/         # 浏览器端工具、状态与展示辅助（Agent client、命令、文件图标、Git 状态、
│   │                   # Grokbot 数据、Monaco 主题、UI 音效）
│   ├── shared/         # 客户端/服务端共用的类型、协议与纯函数（跨层禁令见「依赖与安全边界」）
│   └── server/         # 仅服务端：文件系统、SQLite、pi SDK、RPC、会话、终端、后台循环与第三方集成
│       ├── rpc-manager.ts   # 创建并复用进程内 AgentSessionWrapper：pi session、命令分发、SSE 事件、
│       │                    # 权限确认、Ask User Questions、自定义工具与审计上下文
│       ├── sessions/        # 会话读取、搜索与变更（JSONL 原子写入，并同步清理缓存/sidecar）
│       ├── session-export/ files/ terminal/ wechat/ scheduler/ rss/ kanban/ notes/ channels/
│       │                    github-trending/ notifications/ self-tools/ turn/ web-access/ subagent-*
│       └── *-db.ts *-store.ts   # 各功能的 SQLite / JSON store（Inbox、LLM Audit、Token Audit、
│                                #   Kanban、Profile、Subagent）
├── scripts/            # 迁移、恢复、部署与字体处理
├── agent-skills/       # 项目维护的 Agent skill
├── bin/pi-work.js      # CLI 启动入口
├── docs/               # adr/（架构决策）、agents/（issue-tracker、triage-labels、domain 约定）
├── tests/              # vitest 测试（unit/ + 隔离实例，见 tests/README.md）
├── public/             # 静态资源
├── instrumentation.ts  # Node.js 服务启动入口：wechat 监控、Scheduler、Kanban、RSS 刷新循环、
│                       # 终端 WebSocket 服务的 bootstrap；改启停逻辑要检查幂等性、退出清理与热重载
├── electron-shell/     # 可选 Electron 外壳，非核心 Web 应用
└── 顶层配置            # next.config.ts、tailwind.config.ts、postcss.config.mjs、tsconfig.json、
                        # eslint.config.mjs、vitest.config.ts、proxy.ts（全局鉴权网关）、
                        # .npmrc / pnpm-workspace.yaml、Dockerfile + docker-compose.yml
```

**关键服务关系**

- 只读会话主要从 pi 的 JSONL 文件读取；发送消息、模型切换、分支导航和压缩都通过 `AgentSessionWrapper` 完成。
- `lib/server/terminal/` 是独立 WebSocket + `node-pty` 服务（App Router route handler 不处理 WebSocket upgrade），默认端口 `30142`。

## 依赖与安全边界

- `lib/shared` 不得引入 `fs`、`path`、SQLite、Node API 或 pi SDK。
- `lib/client`、`hooks` 和客户端组件不得依赖 `lib/server`；不要把 `better-sqlite3`、`node-pty`、服务端配置/日志等传入浏览器 bundle。
- 服务端文件/API 操作必须复用 `lib/server/file-access.ts` 的允许根目录校验，不能仅凭用户传入路径读写任意文件。
- 危险命令权限由 `lib/server/dangerous-patterns.ts` 和 RPC 会话处理；不要绕过确认流程或把密钥写入日志。
- 终端连接依赖随机 token；修改终端 host/port、鉴权或 cwd 校验时同时检查 `/api/terminal` 和 WebSocket 服务。
- `~/.pi/agent/`、`~/.pi-work/` 以及环境变量可能含有密钥和用户数据，未经明确要求不要读取、修改或提交。
- SQLite 存储和迁移应保持幂等、向后兼容；不要把 `~/.pi-work/*.db`、会话 JSONL、上传文件或构建产物提交到仓库。

## 配置和数据

- pi 会话/配置默认位于 `~/.pi/agent/`；Pi Work 配置位于 `~/.pi-work/config.yaml`。
- Scheduler、RSS、Inbox、Token 审计、LLM 审计、看板、GitHub Trending、Subagent、频道各自使用 `~/.pi-work/` 下的 SQLite 数据库，并支持对应的 `PI_WORK_*_DB` 环境变量覆盖。
- 自定义工具、Append System、文件预览限制和右侧面板等配置通常在新 Agent session 创建时读取；修改设置后不要假定已有 session 会自动更新。
- `PI_CODING_AGENT_DIR` 可覆盖 pi 数据目录；不要在测试中直接污染真实用户目录。
- 所有数据默认位于 `~/.pi-work/`，可用 `PI_WORK_DATA_DIR` 整体覆盖（各 `PI_WORK_*_DB` 单项覆盖优先级更高）；多实例并存时用 `pnpm run dev:isolated` 启动完全隔离的实例（见 `scripts/dev-isolated.mjs`）。

## 开发约定

- 不要擅自启动服务并进行 UI 测试。
- 修改前先阅读相关入口、调用方和共享类型，做最小改动，避免无关重构。
- 所有用户可见文案遵循现有 `useI18n` / `lib/shared/i18n-dict/` 机制；不要随意硬编码单语言文本。
- 优先使用现有 store、hook、API client 和错误处理方式；跨层新增协议时同步更新共享类型、服务端路由和客户端调用方。
- 涉及 pi SDK、session JSONL、ToolCall、模型协议或 SQLite schema 的修改，要检查兼容旧数据和重复事件（SSE 重连/压缩可能重放事件）。
- 修改 pi 依赖时保持相关 `@earendil-works/pi-*` 包版本同步，使用精确版本并更新 `pnpm-lock.yaml`；`typebox` 与 pi-coding-agent 内部使用的版本必须一致（工具的 schema 类型要在同一个包实例里），所以也精确锁定。
- 新增依赖用 `pnpm add` / `pnpm add -D`（不要手改 `package.json` 后跑 npm）。改动 `pnpm-workspace.yaml` 的 `allowBuilds` / `publicHoistPattern` 时，同步更新该文件里的注释说明理由。
- 除非用户允许，否则永远不要直接或间接损坏 `~/.pi` 或 `~/.pi-work` 的用户数据，这是红线。

## 常用命令与验证

```bash
corepack enable                     # 启用固定版本的 pnpm
pnpm install
pnpm run dev                        # Next.js 开发服务器，端口 30141
pnpm run dev:isolated               # 隔离开发实例（web 30143 / ws 30144，独立数据根与构建目录，见 scripts/dev-isolated.mjs）
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint <修改的文件>
pnpm run lint
pnpm run build                      # 仅 CI/发版验证时运行（会覆盖共享的 .next/，见下）
pnpm test                           # vitest，需要隔离实例（见 tests/README.md）
```

日常开发循环不要运行 `next build`，它会覆盖共享的 `.next/`，可能影响正在运行的生产/开发服务器。完成修改后至少运行与改动范围匹配的 TypeScript 检查或 ESLint；涉及会话、流式事件、权限、文件操作、后台任务或集成时补充手动 smoke test，并在最终说明已验证和未验证的部分。

## Agent skills

### Issue tracker

Issue 与 spec 记录在本仓库的 GitHub Issues（`xyl2024/pi-work`），统一用 `gh` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### Triage labels

沿用默认的五个分诊标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（single-context）：根目录 `CONTEXT.md` + `docs/adr/`。详见 `docs/agents/domain.md`。
