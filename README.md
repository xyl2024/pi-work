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

要求 Node.js 22+，并使用 pnpm 作为包管理器（版本固定在 `package.json` 的 `packageManager` 字段）。

```bash
corepack enable             # 让 pnpm 走固定版本（Node 自带 corepack）
pnpm install
pnpm run dev                # 开发服务器，端口 30141
```

常用检查：

```bash
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint <本次修改的文件>
```

不要在开发循环中运行 `next build`；生产构建会污染 `.next/`，并可能影响正在运行的开发服务器。需要生产构建时，明确执行：

```bash
pnpm run build
pnpm start
```

### 包管理器注意事项

仓库已从 npm 迁移到 pnpm，锁文件是 `pnpm-lock.yaml`：

- **不要**再生成 `package-lock.json`；新增/升级依赖用 `pnpm add <pkg>`、`pnpm add -D <pkg>`、`pnpm update <pkg>`，`pnpm run` 可略写为 `pnpm <script>`。
- 全部 pnpm 配置在 **`pnpm-workspace.yaml`**（pnpm 11 起设置的家），`.npmrc` 只留注册表/鉴权配置。
- 依赖安装脚本默认被禁用，允许清单是同文件的 `allowBuilds`（`better-sqlite3`、`node-pty` 等原生模块必须允许，否则运行时加载 `.node` 会失败）。
- 与 npm 的两处行为差异需要注意：
  - `pnpm install` **不会**因 `NODE_ENV=production` 跳过 devDependencies（只在显式 `--prod` 时跳过）。
  - node_modules 是严格隔离布局，**没有提升**：代码里 `import "某个间接依赖"` 会失败，必须把它声明为直接依赖。同理，按包名在运行时 `require` 平台包时需要 `publicHoistPattern`（见 `@colbymchenry/codegraph-*`）。
- 改了 `pnpm-workspace.yaml` 里影响解析的配置（`overrides` 等）后，普通 `pnpm install` 不会重新解析；用 `pnpm install --no-frozen-lockfile` 更新 `pnpm-lock.yaml`。
- `electron-shell/` 是独立的 Electron 包（自带 `package.json`，无锁文件），不在 pnpm workspace 内，不要把它加进 `pnpm-workspace.yaml`。

若生产实例（`pnpm start`，端口 30141）与开发实例在同一目录并存，两者共享 `~/.pi-work/` 与 `~/.pi/agent/` 会互相干扰（定时任务/频道重复执行等）；开发请用隔离模式 `pnpm run dev:isolated`（数据、端口完全独立，详见下方“多实例隔离”）。

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

所有 Pi Work 数据（`config.yaml`、各数据库、频道凭据、会话命名 sidecar、Agent Todo、Profile、日志、微信监控锁等）默认都位于 `~/.pi-work/`。设置 `PI_WORK_DATA_DIR` 可整体指向另一个数据根；`PI_WORK_*_DB` 单项覆盖优先级高于它。

### 多实例隔离（开发 / 生产并存）

在同一目录同时运行生产实例（`next start` / `bin/pi-work.js`，端口 30141）和开发实例（`next dev`，端口 30141）时，两个进程会共享同一份 `~/.pi-work/` 与 `~/.pi/agent/`，导致后台循环与存储互相竞争：同一定时任务被触发两次、频道 worker 重复轮询、SQLite / JSON 丢失更新等。

用隔离模式启动开发实例，让开发使用完全独立的数据：

```bash
pnpm run dev:isolated         # 等价于 node scripts/dev-isolated.mjs
```

`dev:isolated` 默认把开发实例隔离到：

- Web 端口 `30143`（生产的 30141 空闲）
- 终端 WebSocket 端口 `30144`（生产的 30142 空闲）
- Pi Work 数据根 `~/.pi-work-dev`（`PI_WORK_DATA_DIR`）
- pi agent 目录 `~/.pi-dev/agent`（`PI_CODING_AGENT_DIR`）

自定义路径与端口：

```bash
node scripts/dev-isolated.mjs --port 4000 --term-port 4001 \
  --data-dir ~/.pi-work-staging --agent-dir ~/.pi-staging/agent
```

首次启动的隔离 agent 目录没有登录凭证和模型（`auth.json` / `models.json`），需要在界面重新登录或手动复制：

```bash
cp -r ~/.pi/agent ~/.pi-dev/agent
```

日志默认写入：

```text
~/.pi-work/logs/pi-work-YYYY-MM-DD.log
```

可用环境变量：

```bash
PI_WORK_LOG_LEVEL=debug pnpm run dev
PI_WORK_LOG_FILE=/tmp/pi-work.log pnpm run dev
PI_WORK_LOG_DIR=/tmp/pi-work-logs pnpm run dev
PI_WORK_LOG_FILE=off pnpm run dev
```

### Electron 外壳（可选）

`electron-shell/` 是独立的 Electron 包（不在 pnpm workspace 内，用 npm 装依赖），窗口**直接加载** Pi Work：没有 iframe、没有自绘标题栏、没有 preload 桥。

```bash
cd electron-shell && npm install
npm start        # 自己拉起服务端（随机 loopback 端口 + 本次启动随机凭据）
npm run dev      # 指向隔离开发实例 http://127.0.0.1:30143（先跑 pnpm run dev:isolated）
```

- `npm start` 启动的是**外壳自己的服务端进程**：用 `resources/runtime/` 下的独立 Node 运行时（不是 Electron 自带的 Node，因此 `better-sqlite3` / tree-sitter 等原生模块不需要按 Electron ABI 重编译）跑 `bin/pi-work.js`，端口每次启动随机、只绑 `127.0.0.1`，凭据（`PI_WORK_DESKTOP_SECRET`）每次启动随机生成并由外壳签名注入 cookie（见“信任边界”）。决策在 `electron-shell/server-process.js`（纯 module，单测在 `tests/unit/electron-shell-server-process.test.ts`）。
- 退出时按平台结束整个进程树（POSIX 信号进程组 / Windows `taskkill /T /F`）；关窗只是隐藏到托盘，服务端继续跑。托盘菜单能显示/隐藏窗口、重新加载应用、退出；关窗后到点的定时任务 / RSS / 看板 / 频道照常执行，只有托盘「退出」才停。窗口可见性与应用寿命是两条规则，在 `electron-shell/lifecycle.js`（纯 module，单测在 `tests/unit/electron-shell-lifecycle.test.ts`）。
- 两个“不拉起服务端”的口子：`npm run dev`（即 `electron . --dev`，只连隔离实例，不碰生产数据）、显式 `PI_PORT`（表示“服务端我自己已经起好了，连这个端口”）。源码检出里没有打包运行时，用 `PI_WORK_NODE=$(which node) npm start` 指定。
- 服务端不可达或起不来时窗口显示可手动重试的错误页；外部链接交给默认浏览器，应用窗口不会被导航走；重复启动只保留一个实例。
- Windows 上使用原生窗口控件（`titleBarStyle: "hidden"` + Window Controls Overlay），应用顶部用 `env(titlebar-area-height, 0px)` 预留条带（`app/globals.css` 的 `.pi-shell-titlebar`），因此没有自绘标题栏也不会有双重标题栏；该变量在浏览器里恒为 0，不影响 Web 形态。

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
