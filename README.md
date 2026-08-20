# Pi Work

Pi Work 是 [pi coding agent](https://github.com/badlogic/pi-mono) 的 Web UI：在浏览器中浏览会话、与智能体实时对话、切换分支、查看项目文件，并使用右侧工具面板完成辅助工作。

## 快速开始

无需安装即可运行：

```bash
npx @xyl2024/pi-work@latest
```

或全局安装：

```bash
npm install -g @xyl2024/pi-work
pi-work
```

启动后访问 <http://localhost:30141>。

### 启动参数

```bash
pi-work --port 8080               # 自定义端口
pi-work --hostname 127.0.0.1      # 仅本机访问
pi-work -p 8080 -H 127.0.0.1     # 组合使用

PORT=8080 pi-work                 # 也支持 PORT 环境变量
```

## 主要功能

- 按工作目录浏览和搜索 pi 会话
- SSE 实时对话、引导、追加和中止
- 会话内分支、分支导航和会话树
- 模型、思考级别和工具选择
- 长会话压缩、会话回放、导出 HTML 和自动命名
- 项目文件浏览、搜索、编辑、重命名、删除和实时监听
- Markdown、代码、Mermaid、SVG、ECharts、图片、音频、视频和 PDF 查看
- Todo、Agent Todo、收藏、RSS、终端、Canvas、Git Diff 面板
- Token 使用审计和 LLM API 调用审计
- 定时任务、Inbox、技能配置、模型配置和提示词配置
- WeChat 登录、收发消息和入站监控
- ⌘K / Ctrl+K 命令面板

## 开发

要求 Node.js 22+。

```bash
npm install
npm run dev                 # 开发服务器，端口 30141
```

常用检查：

```bash
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint <本次修改的文件>
```

不要在开发循环中运行 `next build`；生产构建会污染 `.next/`，并可能影响正在运行的开发服务器。需要生产构建时，明确执行：

```bash
npm run build
npm start
```

在本机长期运行时，也可以使用项目环境提供的启动脚本：

```bash
/home/alone/.xyl_scripts/run_pi_web.sh
```

## 数据与配置

Pi Work 默认使用以下数据目录：

- pi 会话：`~/.pi/agent/sessions`
- Pi 配置：`~/.pi/agent/`
- Pi Work 数据：`~/.pi-work/`
- 用户 Todo 数据库：`~/.pi-work/todos.db`
- 定时任务数据库：`~/.pi-work/scheduler.db`
- RSS 数据库：`~/.pi-work/rss.db`
- Inbox 数据库：`~/.pi-work/inbox.db`
- Token 审计数据库：`~/.pi-work/token-audit.db`
- LLM 审计数据库：`~/.pi-work/llm-audit.db`

可通过 `PI_CODING_AGENT_DIR` 指定 pi 数据目录。各数据库也支持对应的 `PI_WORK_*_DB` 环境变量覆盖路径。

日志默认写入：

```text
~/.pi-work/logs/pi-work-YYYY-MM-DD.log
```

可用环境变量：

```bash
PI_WORK_LOG_LEVEL=debug npm run dev
PI_WORK_LOG_FILE=/tmp/pi-work.log npm run dev
PI_WORK_LOG_DIR=/tmp/pi-work-logs npm run dev
PI_WORK_LOG_FILE=off npm run dev
```

## 当前目录结构

```text
app/
  api/                         Next.js 固定 URL 路由；不要把 route.ts 移出这里
components/
  app-shell/                   页面壳层、工作区和命令面板
  chat/                        对话窗口、输入框、消息渲染和权限交互
  files/                       文件浏览器和文件查看器
  panels/                      右侧工具面板
  rss/                         RSS 面板
  scheduler/                   定时任务 UI
  sessions/                   会话侧栏、会话库和分支视图
  settings/                   设置、模型、技能和提示词配置
  todos/                       用户 Todo 与 Agent Todo UI
  ui/                          通用 UI 原语
hooks/
  useAgentSession/             会话加载、SSE、导航和 Agent 控制
  *.ts(x)                      客户端 hooks 与模块级 UI store
lib/
  client/                      浏览器运行时工具和客户端状态
  server/                      文件系统、SQLite、pi SDK 和后台循环
    agent-todo-tool/
    rss/
    scheduler/
    session-export/
    terminal/
    user-todo/
    wechat/
  shared/                      client/server 共用的类型和纯函数
    agent-todo-tool/
    i18n-dict/
    rss/
    user-todo/
    wechat/
scripts/                      运维、恢复和手工 smoke test
electron-shell/                可选 Electron 外壳
agent-skills/                  随项目维护的产品相关 Agent skill
instrumentation.ts             服务启动时 bootstrap 后台循环
```

## 架构概览

```text
Browser                 Next.js Server                 AgentSession
  │                          │                              │
  ├─ GET /api/sessions ──────▶ lib/server/session-reader      │
  ├─ GET /api/sessions/[id] ─▶ 读取 JSONL 会话文件            │
  ├─ POST /api/agent/[id] ───▶ lib/server/rpc-manager ───────▶ session.prompt()
  └─ SSE /api/agent/[id]/events ◀───────────────────────────── session.subscribe()
```

- **只读浏览会话**：直接读取 `.jsonl`，不会创建 AgentSession。
- **发送消息**：由 `lib/server/rpc-manager.ts` 创建或复用进程内 AgentSession。
- **服务启动**：`instrumentation.ts` 启动 WeChat、Scheduler、RSS 和 Terminal 后台服务。

## Import 边界

`lib/` 采用三层结构，依赖方向如下：

```text
lib/client/  ──▶  lib/shared/  ◀──  lib/server/
```

- `lib/shared/` 不得引入 Node API、文件系统、SQLite 或 pi SDK。
- `lib/client/` 不得引入 `lib/server/`。
- `components/` 只能使用 `lib/shared/` 和 `lib/client/`。
- `app/api/` 是 Next.js 路由适配层；可调用 `lib/server/`。
