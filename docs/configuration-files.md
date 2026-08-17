# Pi Work 配置 / 数据文件清单

> 回答一个具体问题: **"Pi Work 的状态到底存放在哪些文件里?"**
>
> 现状是分散的 — 既没有一个总目录,也没有"打开配置" 入口。这份文档
> 把每个文件都列出来,标注它存什么、谁写、谁读、备份优先级,方便日常
> 维护、迁移、排查。

---

## 目录速览

| 目录                                            | 角色                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `~/.pi-work/`                                    | **Pi Work 自己的数据**。配置 + 业务数据 + 运行时缓存,全部混在一起。            |
| `~/.pi/agent/`                                   | **Pi agent 核心数据**。会话、模型、auth、skills、Slash 命令、部分 MCP 缓存。 |
| `~/.pi-work/workspace/`                          | Pi Work 用来启动 agent 的工作目录(每个 session 一个文件树)。             |
| `~/.pi-work/payloads/`                           | HTTP 请求 / 响应 payload 缓冲(调试用)。                                          |
| `~/.pi-work/workspace/pi-cwd-default`            | 新会话默认 cwd 目录(`POST /api/default-cwd` 自动创建)。                       |

---

## 历史遗留 / 数据迁移残留

| 文件                                 | 含义                                                                                                            | 建议                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `~/.pi-work/todos.json.migrated.<ts>` | 旧版 `todos.json` 在第一次读 todos.db 时被改名(不是删除)。内容是迁移前最后一次 `JSON.stringify` 的快照。 | **不要删除**。可以用 `scripts/todos-restore.ts` 反向迁移回 `todos.db`。         |
| `~/.pi-work/config.yaml.back`        | 上一次 `Config` 写入前的备份。                                                                              | 留一份即可,定期手动清理。                                                              |
| `~/.pi-work/todos.db.bak.<ts>`       | `todos.db` 在 schema 迁移失败时的自动备份。                                                                | 历史迁移产物,通常无意义,可以清理。                                                    |
| `*.bak.<ts>`(其他 db 上残留)        | `finance.db`、`http_collections.db` 等**已被删除的模块**的 db 备份残留,代码里已搜不到引用。              | 可以安全删除;字段值留空也无所谓,反正不会被读到。                                      |
| `mindmaps.db-shm` / `mindmaps.db-wal` | 已被删除的 mindmap 模块残留(注意:这些是 Sqlite WAL,没有对应 `db` 主文件,孤立)。                          | 同上,直接删。                                                                          |
| `inbox.db-shm` / `inbox.db-wal`     | inbox 模块的 WAL 文件。                                                                                    | 留着,正常文件。                                                                        |
| `rss.db-shm` / `rss.db-wal`         | RSS 模块的 WAL 文件。                                                                                       | 留着,正常文件。                                                                        |
| `token-audit.db-shm` / `token-audit.db-wal` | token-audit 模块的 WAL 文件。                                                                              | 留着,正常文件。                                                                        |
| `todos.db-shm` / `todos.db-wal`     | todos 模块的 WAL 文件。                                                                                     | 留着,正常文件。                                                                        |
| `scheduler.db-shm` / `scheduler.db-wal` | scheduler 模块的 WAL 文件。                                                                                | 留着,正常文件。                                                                        |

---

## A. 配置文件(`~/.pi-work/`)

| 文件                                | 存什么                                                                                                                            | 谁写                                                                                       | 谁读                                                                                     | 备份优先级 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------- |
| **`config.yaml`**                   | 主配置,YAML。下方的 7 个字段全在这里。                                                                                | `PUT /api/settings`                                                                        | `lib/config.ts` (`readConfig()` 在每次 server 启动 + 每次 RPC start 时调用)         | ★★★★★     |
| `mcp.json`                          | MCP server 列表(`{ enabled, servers[] }`)。                                                                  | `PUT /api/mcp/config`(`lib/mcp/*`)                                                       | `GET /api/mcp/config`(SettingsModal 加载)                                              | ★★★★☆     |
| `todo-tools.json`                   | 旧版 user-side todo 工具开关:`["user_todos_list", "user_todo_description"]` 的子集。 | `PUT /api/todo-tools`                                                                     | `lib/todo-tools-config.ts` 在每个 session 启动时读                                       | ★★★☆☆     |
| `pinned.json`                       | 在 CWD picker 里 pin 的项目目录 path 列表(`string[]`)。                                                                  | `PUT /api/pinned-cwds`                                                                     | `GET /api/pinned-cwds`(`CwdPicker`)                                                    | ★★★☆☆     |
| `favorites.json`                    | favorites 列表(`string[]`,会话 uuid)。                                                                                              | `PUT /api/favorites`                                                                       | `GET /api/favorites`                                                                    | ★★★☆☆     |

> ⚠️ **同一类信息被切到两个文件**: `todo-tools.json` 控的是 user-side todo
> 工具(`user_todos_list` / `user_todo_description`);`config.yaml` →
> `custom_tools.enabled` 控的是 agent-side 工具(`agent_todo` / `show_media` /
> `ask_user_questions`,以及 legacy `show_file`)。
> 是历史遗留 — 两份开关逻辑不同,迁一份会影响另一份。`lib/config.ts:85-87` 注释
> 里讲过这件事。

### `config.yaml` schema(`PiWorkConfig`)

来源: `lib/config.ts`。**AGENTS.md 描述已经严重过时** — 下面是从代码 grep 出来的真实字段:

```yaml
# 危险命令的正则拦截
dangerous_patterns:
  rules:
    - { name: "...", pattern: "..." }
  timeout_ms: 300000       # ms,默认 5 分钟

# 扩展
extensions:
  clawd_on_desk:
    enabled: false         # (其他 plugin 开关未实现)

# 右侧 10 个 tab 按钮的显隐
right_side_bar:
  todos: true
  canvas: true
  translate: true
  json: true
  rss: true
  favorites: true
  tokens: true
  toolCalls: true
  gitDiff: true
  conversationTree: true

# agent-side 工具开关
# (注意 user_todos_list / user_todo_description 不在这里,在 ~/.pi-work/todo-tools.json)
custom_tools:
  enabled:
    - agent_todo
    - show_media       # `show_file` 是 legacy alias,会在 parse 时被重写
    - ask_user_questions

# 是否在每个 session 加载 ~/.pi/agent/APPEND_SYSTEM.md
# 关闭并不会删除文件,只是这一轮 prompt 不注入(再开就回来)
append_system:
  enabled: true

# ChatInput 空内容时的"打字机"占位短语
# 按 locale 切换,缺哪个 locale 就回退到 bundled 默认
typewriter_phrases:
  en: [...]
  zh: [...]

# 文件预览大小上限(MB,超过走文本预览)
# 注意: 当前 schema 只支持 3 种 kind: text / image / pdf
file_viewer:
  max_size_mb:
    text: 10
    image: 10
    pdf: 50
```

允许范围(`lib/file-viewer-limits.ts`):

| kind  | min | max | 默认 |
| ----- | --- | --- | ---- |
| text  | 1   | 100 | 10   |
| image | 1   | 100 | 10   |
| pdf   | 1   | 500 | 50   |

> audio / video / font 不在当前 schema 里 — 以后加新 kind 需要同时改
> `lib/file-viewer-limits.ts` 和 `lib/config.ts`(两个文件的镜像,见
> `lib/file-viewer-limits.ts` 顶部注释)。

**fail-open 原则**: 所有字段都做了宽容的解析 — 字段缺失 / 格式错误 / 未知值
都回退到默认值,这样手工编辑 YAML 不会把整个应用炸掉。仅当字段值是显式的
错误状态(如 `enabled: false` / `enabled: []`)才会被严格执行。

---

## B. SQLite 业务库(`~/.pi-work/*.db`)

| 文件                  | 用途                                                                  | 路径来源                                                                                          | 主要接口 / 文档                                                              |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **`todos.db`**        | 用户 todo 列表(标题、描述 HTML、状态、tag、截止日期、图片)。 | `lib/db.ts` (`PI_WORK_TODOS_DB` env 可覆盖)                                                | `lib/todo-store.ts`,`app/api/todos/*`,`components/TodoPanel.tsx` |
| **`agent-todo/`**     | 每个 session 一份 JSONL(`<sessionId>.jsonl`),append-only snapshots。 | `lib/agent-todo-store.ts`                                                                        | `app/api/agent/[id]/agent-todo`, `hooks/useAgentTodo.ts`             |
| **`scheduler.db`**    | 定时任务 + 运行历史。                                                  | `lib/scheduler-db.ts` (`PI_WORK_SCHEDULER_DB` env 可覆盖)                              | `app/api/scheduled-tasks/*`,`lib/scheduler/*`                       |
| **`rss.db`**          | RSS 源 + 文章 + 已读状态。                                              | `lib/rss-db.ts` (`PI_WORK_RSS_DB` env 可覆盖)                                                  | `app/api/rss/*`,`lib/rss/*`,`hooks/useRss.ts`                       |
| **`inbox.db`**        | 跨模块的"消息栏" — scheduler / wechat 把推送堆到这里,前端 5s 轮询。 | `lib/inbox-db.ts` (`PI_WORK_INBOX_DB` env 可覆盖)                                              | `app/api/inbox/*`,`docs/inbox.md`                                    |
| **`token-audit.db`**  | token 消耗审计(给 `TokensPanel` 用)。                                | `lib/token-audit-db.ts` (`PI_WORK_TOKEN_AUDIT_DB` env 可覆盖)                                  | `components/TokensPanel.tsx`                                         |
| *(已删除)* `finance.db` / `http_collections.db` / `mindmaps.db` | 早期功能模块,代码已搜不到引用。主文件已删,但 `.bak` / WAL 可能还残留。 | — | 安全删除。 |

### `agent-todo/<sessionId>.jsonl` 格式

来源: `docs/agent-todo/design.md` + `lib/agent-todo-store.ts`。

```jsonl
{"ts":1700000000000,"action":"create","stateAfter":{"tasks":[...], "nextId":2}}
{"ts":1700000001000,"action":"update","stateAfter":{...}}
```

当前状态 = 最后一行 `stateAfter`。`agent-todo-store.ts` 永远在 `writeFileSync`
之后 `fsync`,所以读到即最新(append-only + fdatasync 是这套
"agent 重做会重新生成" 的设计基石 — 见 `docs/agent-todo/design.md:690`)。

---

## C. 媒体 / 资产目录(`~/.pi-work/`)

| 目录              | 用途                                                                                                                        | 注意事项                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `todo_images/`    | todo 描述里嵌入的图片(原文/缩略图)HTTP 上传落点。                  | 上传接口 `app/api/todo-images/route.ts`,仅 todo 描述引用,**不在公共 URL 之下**。 |
| `payloads/`       | HTTP 请求 / 响应 payload 缓冲(用于 `/api/agent` 一类长流程的"重放 / 恢复 / 调试")。 | 可能很大,定期清理。                                                  |
| `workspace/`      | 工作目录。每个 pi-work session 默认 cwd 都在这下面(子目录 `pi-cwd-*`)。                  | 视作用户文件,**不要随便改**。                                        |
| `system-prompt/`  | 给 agent 写 prompt 时的底稿(YAML / Markdown),只读,从来不被运行时写。                    | 可选借鉴资源,可删。                                                   |
| `profile/`        | 用户头像 + `user.json`。                                                                                                    | 仅渲染侧使用。                                                        |
| `logs/`           | server 启动日志(可能含 token 审计、wechat 收发的结构化日志)。                                          | 视情况保留。                                                          |
| `wechat/`         | 微信相关:`account.json`(凭证,chmod 600)、`sessions.log`(操作审计)。          | `account.json` 是凭证,密码学级敏感。详见 `docs/wechat-integration.html`。 |
| `wechat-monitor.lock` | 单实例锁文件(JSON)。服务器启动时占用,防止多进程抢监控。                                    | 不需要手动管。                                                        |
| `todo_images/`    | todo 描述嵌入的图片(原文/缩略图)。                                                                              | —                                                                     |

---

## D. `~/.pi/agent/`(Pi 核心数据,Pi Work 会读 / 部分写)

| 文件                  | 用途                                                                                                          | 谁写                                                                                        | 谁读                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `settings.json`       | 默认模型、thinking 级别、API base 等。                                                                       | pi agent 自己                                                                              | `app/api/models` 在新会话前 fetch defaultModel;`/api/translate` 读完后**不写**。 |
| `models.json`         | 自定义模型清单(含 icon、thinkingLevels 等等). | `PUT /api/models-config`                                                                    | `GET /api/models`(左栏模型下拉)                                                       |
| `auth.json`           | provider 鉴权信息。                                                                                          | `POST /api/auth/<provider>`                                                                   | pi agent 自己                                                                          |
| `prompts/`            | slash 命令模板。                                                                                          | `POST /api/prompts`(`lib/prompts/*`)                                                          | `GET /api/prompts`(Slash 菜单)                                                      |
| `extensions/`         | 扩展源码目录。                                                                                                | 用户手动 / marketplace install                                                              | pi agent 启动时加载                                                                  |
| `skills/`             | marketplace skill 目录。                                                                                 | `SkillsConfig` 模态里的 install                                                             | pi agent 启动时加载                                                                  |
| `mcp-cache.json` / `mcp-npx-cache.json` / `mcp-onboarding.json` | MCP cache(npx 是否已拉、首次 onboarding 状态)。                              | pi agent 自己                                                                              | pi agent 自己                                                                          |
| `sessions/<encoded-cwd>/<ts>_<uuid>.jsonl` | 会话 JSONL(append-only)。                                                                 | pi agent 自己                                                                              | `lib/session-reader.ts`(只读)、`useAgentSession` 通过 SSE 接收增量            |
| `APPEND_SYSTEM.md`    | 每个 session 都会拼到 system prompt 的尾部。                                                              | `PUT /api/append-system`(`SAVE 按钮`)                                                          | pi agent 自己                                                                          |
| `run-history.jsonl`   | 单进程运行历史(`run-history`)。                                                                        | pi agent 自己                                                                              | (读方未在 Pi Work 代码里出现,纯 pi 用)                                          |
| `models-store.json`   | pi 自己的"上次选过哪个模型"小存储(往往是空)。                                                          | pi agent 自己                                                                              | pi agent 自己                                                                          |

> ⚠️ Pi Work 不会动 `~/.pi/agent/sessions/` 之外的 pi 内部文件 — 任何
> "settings.json / auth.json 被 Pi Work 改写" 的情况都是 bug。

---

## E. 真实存在的"配置入口"

也就是用户能在 UI 上看到的、能动的东西:

| 入口                                                                  | 改什么                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **SettingsModal**(`components/SettingsModal.tsx`)               | 改 `config.yaml` 7 个字段 + `~/.pi/agent/APPEND_SYSTEM.md` 内容                                                       |
| **ModelsConfig**(`components/ModelsConfig.tsx`)                | 改 `~/.pi/agent/models.json`                                                                                            |
| **PromptsConfig**(`components/PromptsConfig.tsx`)              | 改 `~/.pi/agent/prompts/` 下的文件                                                                                  |
| **SkillsConfig**(`components/SkillsConfig.tsx`)                | npm / git install 到 `~/.pi/agent/skills/`                                                                            |
| **TodoPanel**(`components/TodoPanel.tsx`)                      | 读写 `todos.db`                                                                                                       |
| **TodoTools 设置**(嵌入 `TodoPanel.tsx` 内部,不是独立 modal) | 改 `todo-tools.json`                                                                                                  |
| **SchedulerModal**(`components/SchedulerModal.tsx`)            | 改 `scheduler.db`                                                                                                     |
| **RssPanel**(`components/RssPanel.tsx`)                       | 改 `rss.db`                                                                                                            |
| **InboxModal**(`components/InboxModal.tsx`)                   | 改 `inbox.db`                                                                                                          |
| **CwdPicker**(`components/CwdPicker.tsx`)                     | 改 `pinned.json`                                                                                                       |
| **SessionSidebar** 里的 Favorites 按钮                         | 改 `favorites.json`                                                                                                    |
| **McpConfig**(`components/McpConfig.tsx`) | 改 `mcp.json`                                                                                                          |

> **没有统一入口** — 这是当前最显著的 UX 问题。如果要做"统一配置中心",可以
> 改的方向是把 SettingsModal 升级成一个"Settings Hub",把上面 9 个 modal
> 嵌进去(而不是用 Tab 内部再嵌套 Tab)。

---

## F. 环境变量 / 路径覆盖

| 变量                          | 默认                                            | 含义                                                              |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `PI_CODING_AGENT_DIR`         | `~/.pi/agent`                                    | 改 pi 核心数据根目录。`README.md` 提过。                       |
| `PI_WORK_TODOS_DB`            | `~/.pi-work/todos.db`                            | todos 库路径。                                                     |
| `PI_WORK_SCHEDULER_DB`        | `~/.pi-work/scheduler.db`                        | scheduler 库路径。                                                 |
| `PI_WORK_RSS_DB`              | `~/.pi-work/rss.db`                              | RSS 库路径。                                                       |
| `PI_WORK_INBOX_DB`            | `~/.pi-work/inbox.db`                            | Inbox 库路径。                                                     |
| `PI_WORK_TOKEN_AUDIT_DB`      | `~/.pi-work/token-audit.db`                      | token 审计库路径。                                                 |
| `PI_WORK_PUBLIC_BASE_URL`     | `http://localhost:<port>`                        | 影响 `user_todo_description` 工具返回的图片 URL origin。 |
| `NODE_ENV`                    | —                                                | **不要在生产服务器 shell 里跑 `npm install`** — 见 AGENTS.md。 |

---

## G. 备份策略

按"用 1MB 损失多大" 排,从高到低:

1. **必须备份**(丢失后无恢复手段 / 手动重写代价以天计)
   - `~/.pi-work/config.yaml`(自己配置)
   - `~/.pi-work/todo-tools.json`(工具开关)
   - `~/.pi-work/mcp.json`(MCP servers)
   - `~/.pi-work/pinned.json` / `favorites.json`
   - `~/.pi-work/todos.db`(用户数据)
   - `~/.pi-work/scheduler.db`(定时任务)
   - `~/.pi-work/rss.db`(订阅)
   - `~/.pi-work/inbox.db`(消息栏)
   - `~/.pi-work/token-audit.db`(审计)
   - `~/.pi-work/agent-todo/`(最近会话的任务计划)
   - `~/.pi-work/workspace/`(用户文件)
   - `~/.pi-work/todo_images/`(todo 嵌入图片)
   - `~/.pi-work/wechat/account.json`(微信凭证)
   - `~/.pi/agent/settings.json` / `models.json` / `auth.json`
   - `~/.pi/agent/sessions/`(所有会话)
   - `~/.pi/agent/APPEND_SYSTEM.md`(每次都拼到 prompt)
   - `~/.pi/agent/prompts/`(slash 命令)
   - `~/.pi/agent/skills/` + `~/.pi/agent/extensions/`(能力)

2. **可选备份**(可重新生成 / 改了无大差异)
   - `~/.pi-work/profile/`(头像)
   - `~/.pi-work/system-prompt/`(底稿)
   - `~/.pi-work/payloads/`(调试)
   - `~/.pi-work/logs/`(日志)
   - `~/.pi-work/wechat/sessions.log`(微信操作日志)
   - `~/.pi/agent/mcp-cache.json` / `mcp-npx-cache.json` / `mcp-onboarding.json`(pi 自己会重建)

3. **不需要备份**
   - `*.bak.*` / `*.bak.<ts>` / `*.db-shm` / `*.db-wal`(WAL)/ `*.migrated.*`
   - `*.lock`(`wechat-monitor.lock`)

---

## H. 现状问题(为什么"分散"看起来扎眼)

这块不动代码,先记下来,如果有空再做统一化:

1. **同一类信息被切到两个文件**
   - 用户工具开关(`todo-tools.json`,2 个 user-side 工具)与 agent 工具开关(`config.yaml` → `custom_tools.enabled`,3 个 agent-side 工具)分家。`TODO_TOOL_NAMES` 数组里目前是 `["user_todos_list", "user_todo_description"]`(不是 4 个)。
   - `pinned.json`(cwd paths) / `favorites.json`(session uuids)是并列的"标记过的目录/会话"存储。

2. **"配置" 与 "业务数据" 没分组**
   - `~/.pi-work/` 下面既有 `config.yaml` 这种 1KB 的纯配置,也有 `todos.db` 这种 2MB+ 的业务数据,还有 `payloads/` 这种 1GB+ 的临时日志。混在一起。
   - `~/.pi-work/` 自己的代码层 **用 `join(homedir(), ".pi-work", ...)` 硬编码路径**,没有一个 `paths.ts` 集中定义。

3. **路径硬编码**
   - `lib/db.ts` / `lib/scheduler-db.ts` / `lib/rss-db.ts` / `lib/inbox-db.ts` / `lib/token-audit-db.ts` 每个都自己写 `join(homedir(), ".pi-work", "<name>.db")`, 完全没有走 `paths.ts`。
   - 这意味着未来迁移到子目录需要改 5+ 个文件。

4. **环境变量不统一**
   - 有的 override 用 `PI_WORK_TODOS_DB` 这样的全大写,有的(没有)用 `PI_CODING_AGENT_DIR`(这是 pi agent 自己的)。命名空间不一致。

5. **写入位置在调用方就决定**
   - "用户 todo 用 db,agent todo 用 JSONL,append_system 用 markdown" 这种"按业务挑存储"的设计没问题,但**没人写一个"哪些数据是哪些存储" 的总表** — 这份文档就是补这个缺的。

---

## I. 一句话总结

> **Pi Work 的"配置"≈ 12 个文件 + 6 个 SQLite db + 5 个 JSONL/资产目录,横跨
> 两个根目录(`~/.pi-work/` 和 `~/.pi/agent/`),没有任何统一入口。**
> 短期靠这份清单对照,长期如果想整理,最值得做的是:
> - 把 `pins` / `favorites` / `pinned-sessions` 合并到 `config.yaml` 的一个数组字段;
> - 把 `todo-tools.json` 合并到 `config.yaml` → `custom_tools.enabled`;
> - 增加 `lib/paths.ts` 集中所有路径常量;
> - 给 `SettingsModal` 加一个 "Settings Hub" 把所有 modal 收纳进来。
