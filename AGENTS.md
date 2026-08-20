# AGENTS.md

## 项目定位

Pi Work 是 pi coding agent 的 Next.js Web UI，负责会话浏览、实时对话、文件操作和一组辅助面板。技术栈为 TypeScript、React 19、Next.js App Router、Tailwind CSS、SQLite；要求 Node.js 22+。`electron-shell/` 是可选的 Electron 外壳，不是核心 Web 应用。

## 主要功能边界

- **会话与 Agent**：多会话工作区和标签页、SSE 流式事件、分支树导航、上下文压缩、模型/思考级别/工具选择、会话搜索/重命名/删除/导出/自动命名。
- **项目工作区**：按 cwd 浏览和搜索文件，编辑、重命名、删除和查看文本、代码、Diff、图片、音频、视频、PDF、SVG、Mermaid、ECharts；支持 Git Diff 和独立终端。
- **辅助面板**：用户 Todo、Agent Todo、收藏、Canvas、翻译、JSON、RSS、定时任务、Token 审计、LLM API 审计、工具调用统计、会话 Context/Conversation Tree。
- **配置与集成**：模型/API Key/OAuth、Prompt、Skill、危险命令确认、自定义 Agent 工具、右侧按钮、音效和界面设置；另有 Inbox、微信登录/收发消息及 Grokbot 功能。

## 目录与架构

- `app/page.tsx`：应用入口；`app/api/**/route.ts`：Next.js API 适配层。API 路由应保持在 `app/api`，业务逻辑放到 `lib/server`。
- `components/`：React UI，按 `app-shell`、`chat`、`sessions`、`files`、`settings`、`panels`、`todos`、`rss`、`scheduler` 等功能划分。
- `hooks/`：客户端 hooks、会话控制和模块级状态；`hooks/useAgentSession/` 对外从入口文件导出，内部文件不是稳定 API。
- `lib/client/`：浏览器端工具和状态；`lib/shared/`：客户端/服务端共用的类型、协议和纯函数；`lib/server/`：文件系统、SQLite、pi SDK、RPC、后台循环和第三方集成。
- `scripts/`：迁移、恢复、部署和手工 smoke test；`agent-skills/`：项目维护的 Agent skill；`bin/`：CLI 启动入口；`public/`：静态资源。
- `instrumentation.ts`：Node.js 服务启动时引导微信监控、Scheduler、RSS 刷新循环和终端 WebSocket 服务；改动这些后台服务的启动/停止逻辑时要特别检查幂等性、退出清理和开发模式热重载。

### 关键服务关系

- `lib/server/rpc-manager.ts` 创建并复用进程内 `AgentSessionWrapper`，负责 pi session、命令分发、SSE 事件、权限确认、Ask User Questions、自定义工具及审计上下文。
- 只读会话主要从 pi 的 JSONL 文件读取；实际发送消息、模型切换、分支导航和压缩通过 `AgentSessionWrapper` 完成。
- `lib/server/sessions/` 负责会话读取、搜索和变更；修改 JSONL 或会话元数据时保持原子写入，并同步清理缓存/sidecar 数据。
- `lib/server/terminal/` 是独立 WebSocket + `node-pty` 服务，因为 App Router route handler 不处理 WebSocket upgrade；默认端口为 `30142`。

## 依赖与安全边界

- `lib/shared` 不得引入 `fs`、`path`、SQLite、Node API 或 pi SDK。
- `lib/client`、`hooks` 和客户端组件不得依赖 `lib/server`；不要把 `better-sqlite3`、`node-pty`、服务端配置/日志等传入浏览器 bundle。
- 服务端文件/API 操作必须复用 `lib/server/file-access.ts` 的允许根目录校验，不能仅凭用户传入路径读写任意文件。
- 危险命令权限由 `lib/server/dangerous-patterns.ts` 和 RPC 会话处理；不要绕过确认流程或把密钥写入日志。
- 终端连接依赖随机 token；修改终端 host/port、鉴权或 cwd 校验时同时检查 `/api/terminal` 和 WebSocket 服务。
- `~/.pi/agent/`、`~/.pi-work/`、`.claude/settings.local.json` 以及环境变量可能含有密钥和用户数据，未经明确要求不要读取、修改或提交。
- SQLite 存储和迁移应保持幂等、向后兼容；不要把 `~/.pi-work/*.db`、会话 JSONL、上传文件或构建产物提交到仓库。

## 配置和数据

- pi 会话/配置默认位于 `~/.pi/agent/`；Pi Work 配置位于 `~/.pi-work/config.yaml`。
- Todo、Scheduler、RSS、Inbox、Token 审计、LLM 审计等功能各自使用 `~/.pi-work/` 下的 SQLite 数据库，并支持对应的 `PI_WORK_*_DB` 环境变量覆盖。
- 自定义工具、Append System、文件预览限制和右侧面板等配置通常在新 Agent session 创建时读取；修改设置后不要假定已有 session 会自动更新。
- `PI_CODING_AGENT_DIR` 可覆盖 pi 数据目录；不要在测试中直接污染真实用户目录，优先使用临时目录或项目已有的测试脚本。

## 开发约定

- 修改前先阅读相关入口、调用方和共享类型，做最小改动，避免无关重构。
- 所有用户可见文案遵循现有 `useI18n` / `lib/shared/i18n-dict/` 机制；不要随意硬编码单语言文本。
- 优先使用现有 store、hook、API client 和错误处理方式；跨层新增协议时同步更新共享类型、服务端路由和客户端调用方。
- 涉及 pi SDK、session JSONL、ToolCall、模型协议或 SQLite schema 的修改，要检查兼容旧数据和重复事件（SSE 重连/压缩可能重放事件）。
- 修改 pi 依赖时保持相关 `@earendil-works/pi-*` 包版本同步，使用精确版本并更新 `package-lock.json`。
- 除非用户允许，否则永远不要直接或间接损坏 `~/.pi` 或 `~/.pi-work` 的用户数据，这是红线。

## 常用命令与验证

```bash
npm install
npm run dev                         # Next.js 开发服务器，端口 30141
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint <修改的文件>
npm run lint
npm run build                       # 需要生产构建验证时运行
```

日常开发循环不要运行 `next build`，它会污染 `.next/`，还可能影响正在运行的开发服务器。完成修改后至少运行与改动范围匹配的 TypeScript 检查或 ESLint；涉及会话、流式事件、权限、文件操作、后台任务或集成时补充手动 smoke test，并在最终说明已验证和未验证的部分。
