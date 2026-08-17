# Agent Todo — 设计文档

> 一个由 **pi agent 自己在会话内维护**的任务清单，附带一个实时 UI 界面，让用户能随时看到 agent 的计划与执行进度。
>
> **注意：这不是用户侧的 todo 列表**（`lib/todo-tools.ts` / `components/TodoPanel.tsx`，持久化到 `~/.pi-work/todos.db`）。两套系统相互独立，命名上刻意拉开距离，避免任何冲突。

---

## 1. 背景与目标

当用户交给 agent 一个多步骤任务时，模型常常会在中途"跑偏"：忘记自己正在做哪一步、重复劳动、或者在不相关的工具调用之间打转。一个一等公民的 todo 列表，让 agent 自己管理、自己打钩，能起到自我检点（self-checkpoint）的作用；同时让用户透明地看到 agent 自以为在做什么。

设计目标：

- agent 可以 `create` / `update` / `list` / `delete` / `clear` 任务。
- 状态**绑定到单个会话分支**（这是 agent 的工作记忆，不是跨会话的长期记录）。reload 重新水合；compact 不影响（因为不再依赖 `.jsonl`）。
- 状态**独立持久化**到 `~/.pi-work/agent-todo/<sessionId>.jsonl`，追加写、保留每次变更的完整快照，方便追溯历史。文件可被 grep / `cat` / 备份工具直接读取。
- UI 在一个流式 turn 内能感知到每一次变更，通过**右下角圆形按钮 + 紧贴 popover** 呈现任务清单（点击按钮展开，agent 不用 plan 时整个 launcher 不渲染）。
- 不引入新的 DB、不引入新的 RPC 命令。

非目标：

- 不替代用户 todo 列表。用户 todo 是长寿命的个人记录（`todos.db` 后端）；agent todo 是会话内的临时草稿板。
- 不做计划 / 推理层。模型自己写计划，工具只是 dumb storage。
- 不做并行 / 子 agent 任务追踪。一个会话分支对应一棵任务树。

---

## 2. 参考资料

| 主题                    | 来源                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具集成范式            | `lib/show-file-tool.ts`（服务端） + `lib/show-file-tool-types.ts`（客户端） — 拆分原因：SDK 会引入 `child_process`                                              |
| 工具注册位点            | `lib/rpc-manager.ts:362` — `customTools: [...buildTodoTools(...), ...buildShowFileTool()]`                                                                  |
| chat 内联渲染           | `components/MessageView.tsx:706-805` — `isShowFile` 分支，`ShowFileRenderer` 投机性挂载在 tool 卡片下方                                                      |
| SSE 通道                | `app/api/agent/[id]/events/route.ts` — 把 `session.onEvent(...)` 透传给浏览器，按事件类型不做过滤                                                              |
| 前端事件处理            | `hooks/useAgentSession.ts:285-375` — 按 `event.type` switch；新事件类型只需新增一个 `case`                                                                    |
| 设计参考（完整形态）    | `third/rpiv-mono/packages/rpiv-todo` — `tool/types.ts`、`state/reducer`、`state/replay`、`tool/response-envelope`                                            |
| 设计参考（极简实现）    | `node_modules/@earendil-works/pi-coding-agent/examples/extensions/todo.ts` — `add` / `list` / `toggle` / `clear`，用于了解回放惯用法                          |

---

## 3. 命名

| 维度       | 用户 todo                              | agent todo（本文档）                       |
| ---------- | -------------------------------------- | ------------------------------------------ |
| 工具名     | `user_todos_list` / `user_todo_description` | `agent_todo`（单工具，action 区分）        |
| `label`    | `User Todos List` / `User Todo Description` | `Agent Todo`                               |
| 存储       | `~/.pi-work/todos.db`（SQLite）          | `~/.pi-work/agent-todo/<sessionId>.jsonl`（JSONL 追加写） |
| 作用域     | 跨会话、跨 pi-work                      | 单个会话分支                              |
| 历史追溯   | 全部变更都在 DB 里可查                  | 每次 action 写一行 JSONL，含 `stateAfter`，可 `cat` / `grep` |
| UI         | `TodoPanel` 右栏 tab                   | `AgentTodoPanel`：右下角圆形按钮 + 紧贴 popover（点击展开） |

`agent_` 前缀 + snake_case 的 `agent_todo` 名字是刻意选的：

1. 在模型 prompt 里读起来自然（模型会在工具清单里看到这个名字）。
2. 与用户侧的 `todo_*` 家族并列但永不相撞。
3. 符合 pi 的工具命名风格（snake_case、简短、动宾结构）。

`AGENT_TODO_TOOL_NAME = "agent_todo"` 是一个写死的常量 —— 同一个常量驱动 schema 描述、回放过滤（`toolName === "agent_todo"`）、SSE 事件 tag、以及 `MessageView` 里的前端匹配。

---

## 4. 工具接口

单工具、action 区分。模型每做一次变更就调一次；`list` 是只读。

```ts
const AgentTodoParams = Type.Object(
  {
    action: StringEnum(["create", "update", "list", "delete", "clear"] as const, {
      description: "要执行的操作。",
    }),
    subject: Type.Optional(
      Type.String({ description: "create 时的新任务标题，或 update 时的更新标题。" }),
    ),
    description: Type.Optional(
      Type.String({ description: "create / update 使用的长文本描述。" }),
    ),
    id: Type.Optional(Type.Number({ description: "update / delete 使用的任务 ID。" })),
    status: Type.Optional(
      StringEnum(["pending", "in_progress", "completed"] as const, {
        description: "update 使用的目标状态。",
      }),
    ),
  },
  { additionalProperties: false },
);
```

> **Schema 兼容性约束：** 根节点必须是 `Type.Object`。顶层 `Type.Union` 生成的
> JSON Schema 只有 `anyOf`、没有 `type: "object"`，会被 OpenAI-compatible provider
> 拒绝。各 action 的条件必填项由 reducer 校验，而不是放在根 union 中。

### 任务模型（沿用 rpiv-todo）

```ts
interface AgentTask {
  id:          number;
  subject:     string;
  description?: string;
  status:      "pending" | "in_progress" | "completed";
}

interface AgentTaskState {
  tasks:   AgentTask[];
  nextId:  number;     // 单调递增
}

interface AgentTodoDetails {
  tasks:   AgentTask[];               // 操作完成后的完整当前状态
  error?:  string;                    // 操作失败时存在
}
```

### Reducer 契约（沿用 rpiv-todo）

`applyAgentTaskMutation(state, action, params) → { state, op }`，其中 `op`
是 tagged union（`create | update | delete | list | clear | error`）。
校验全部内联到 reducer：create 必填 `subject`、update/delete 必填 `id`。
状态只有 `pending`、`in_progress`、`completed`，update 可以直接设置任意状态；
`delete` 从当前 state 移除任务，审计记录仍然保留历史。
reducer 是纯函数；工具的 `execute` 调它，commit 新状态，返回结果信封。

`clear` 清空任务，但保留 `nextId`，避免后续任务复用旧 ID。

### 返回值

工具结果就是 pi 标准格式：

```ts
{
  content: [{ type: "text", text: <人类可读的总结> }],
  details: <AgentTodoDetails>,
}
```

`details` 仍会进 session `.jsonl`（这是 pi 自己决定的，我们管不了），
但**不**再依赖它做持久化 —— 真正的状态在 `~/.pi-work/agent-todo/<sessionId>.jsonl`
里，第 5 节会展开。`details.tasks` 始终是操作完成后的完整当前任务列表。

### promptSnippet 与 promptGuidelines

`defineTool` 接受 `promptSnippet` 和 `promptGuidelines`，这两个字段会被
注入系统提示，是引导模型正确使用工具的主要抓手。直接借自 rpiv-todo
（`todo.ts:65-74`）：

```
description:
  "Track a small task list for multi-step work. Each task has a subject, an optional description, and one of three statuses: pending, in_progress, or completed."

promptSnippet:
  "Track a small task list for multi-step work."

promptGuidelines:
  1. Use agent_todo for complex work with 5+ steps or when the user gives
     a task list. Skip trivial or conversational requests.
  2. Create tasks before starting multi-step work. Mark tasks in_progress
     before starting them and completed only when they are actually done.
  3. Use create with a subject and optional description; use update with an
     id and only changed fields; use list to view all tasks; use delete to
     remove one task; use clear when the current plan is no longer relevant.
  4. Statuses are pending, in_progress, and completed. Keep subjects short
     and imperative, and keep descriptions concise and focused on the work.
```

---

## 5. 持久化：独立 JSONL 文件，按会话切分

agent todo 状态独立持久化到 `~/.pi-work/agent-todo/<sessionId>.jsonl`。
格式是 JSONL（每行一条 JSON），追加写，不做 in-place 改写。

### 5.1 目录与文件

```
~/.pi-work/agent-todo/
  <sessionId-1>.jsonl
  <sessionId-2>.jsonl
  ...
```

- 目录按需创建（首次写入前 `mkdir -p`）。
- 一个 session 一份文件，`sessionId` 即文件名。
- 文件不存在 ≠ 错误 —— 意味着这个 session 还没产生过任何 `agent_todo`
  调用，state 即 `{ tasks: [], nextId: 1 }`（`EMPTY_STATE`）。
- 删 session 时同步删文件（hook 进 `app/api/sessions/[id]/route.ts`
  的 `DELETE`，见第 10 节）。

### 5.2 行格式

每行是一次 `agent_todo` 工具调用的完整审计记录：

```ts
interface AgentTodoLogEntry {
  v:          1;                                    // schema 版本
  ts:         number;                                // wall-clock (ms)
  sessionId:  string;                                // 反范式存一份，便于 grep
  action:     "create" | "update" | "list" | "delete" | "clear";
  params:     Record<string, unknown>;               // action-specific 入参（不含 action）
  stateAfter: AgentTaskState;                        // 本次 action 之后的状态
  error?:     string;                                // 校验 / 迁移失败时存在
}
```

完整例子（一份文件可能长这样）：

```jsonl
{"v":1,"ts":1700000000000,"sessionId":"abc","action":"create","params":{"subject":"Research foo"},"stateAfter":{"tasks":[{"id":1,"subject":"Research foo","status":"pending"}],"nextId":2}}
{"v":1,"ts":1700000001000,"sessionId":"abc","action":"update","params":{"id":1,"status":"in_progress"},"stateAfter":{"tasks":[{"id":1,"subject":"Research foo","status":"in_progress"}],"nextId":2}}
{"v":1,"ts":1700000002000,"sessionId":"abc","action":"update","params":{"id":1,"status":"completed"},"stateAfter":{"tasks":[{"id":1,"subject":"Research foo","status":"completed"}],"nextId":2}}
{"v":1,"ts":1700000003000,"sessionId":"abc","action":"clear","params":{},"stateAfter":{"tasks":[],"nextId":2}}
```

### 5.3 读写 API

放在 `lib/agent-todo-store.ts`（服务端，与 `todo-store.ts` 同源）：

```ts
// 读：当前态 = 最后一行 stateAfter；空文件返回 EMPTY_STATE
export function readAgentTodoState(sessionId: string): AgentTaskState;

// 读：完整历史（按时间顺序）；空文件返回 []
export function readAgentTodoHistory(sessionId: string): AgentTodoLogEntry[];

// 写：追加一行；fsync 后返回（见下）
export function appendAgentTodoEntry(sessionId: string, entry: AgentTodoLogEntry): void;

// 文件路径（不导出到 client-safe 模块；只给 lib/agent-todo-store 用）
export function agentTodoPath(sessionId: string): string;
```

读取性能：只关心"当前态"时是 O(1) `fs.statSync` 文件大小 + 一次
`readSync` 拿末尾缓冲区即可；不需要把整个文件读进内存。完整历史是
O(n)，仅在用户主动查看历史时调用。

写入性能：一次 `fs.appendFileSync` 即可。`fsync` 在 reducer commit
之后立刻调用一次，保证 SSE 推到前端时、对应文件行已经在磁盘上
（避免推到 UI 之后被前端回查却读不到行的情况）。代价是每次
`agent_todo` 调用多一次 syscall —— 可接受。

### 5.4 reducer 与提交顺序

工具 `execute` 的执行顺序是：

```
1. 读当前态: readAgentTodoState(sessionId)
2. 跑 reducer: applyAgentTaskMutation(currentState, action, params)
3. 拿到 newState（或者 op.kind === "error"）
4. 写文件: appendAgentTodoEntry(sessionId, { v, ts, sessionId, action, params, stateAfter: newState ?? currentState, error? })
5. fsync
6. emit 给 SSE listeners（见第 6 节）
7. return { content, details } 给 pi
```

第 4 步是**唯一的持久化动作**。第 5 步保证事件下发时文件已落盘。
日志中的 `stateAfter` 与文件末行一致，前端读取到的 state
与"再读一遍文件"得到的值等价。

### 5.5 删除、reload

| 事件                       | 文件动作                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| 首次 `agent_todo` 调用      | `mkdir ~/.pi-work/agent-todo` + `appendFileSync` 创建文件 + 写第一行                                     |
| 删 session（DELETE 路由）  | `unlink` 对应 `~/.pi-work/agent-todo/<id>.jsonl`                                                       |
| Next.js /reload / 服务重启 | 不动；下次打开会话时从文件读                                                                             |
| Compact                    | 不动；agent todo 不再依赖 session `.jsonl`                                                               |

### 5.6 为什么不沿用之前的"分支回放"

- 用户希望"独立持久化，方便追溯历史"。把状态写进自己的文件，可以
  单独 `cat` / `grep` / 备份 / 走 git 仓库；不与 session `.jsonl` 耦合。
- "按会话区分" 暗含"每个 session 一份独立文件"，与文件存储一拍即合。
- branch-replay 的"持久化是免费的"好处在用户价值上远小于"独立可读"
  的好处（plan 内容需要能 grep）。
- compact 现在跟 plan 完全脱钩：即使将来 pi 改了 compact 行为（删
  `toolResult`、限制 token 预算等），agent todo 也不受影响。

### 5.7 为什么不写进 `todos.db`（用户 todo 表）

- 用户 todo 跨会话、由用户编辑；agent todo 每个会话一张。
- 混在 SQLite 里就没法"按文件读历史"了，得写 SQL 拼 JSON，
  还涉及 schema 演进。
- 两套系统、两套存储、两套备份策略，符合 CLAUDE.md 里"不可逆操作"
  精神 —— 任何写都不影响另一份。

### 5.8 错误与一致性

- **写入失败**：append 失败时（磁盘满、权限错），把异常抛到
  `execute` 的 try/catch，向 agent 返回一个错误结果（不进 plan，
  不更新 state）。前端不会收到"成功"事件，UI 也不会动。
- **读失败**：文件存在但损坏（手动编辑过、被截断）。readAgentTodoState
  走"try 读最后一行 JSON.parse，失败就当 EMPTY_STATE 处理"，
  并 `logger.warn`。history 读取遇到坏行时跳过该行并 warn，不
  整体失败。
- **并发**：pi agent 在单个 turn 内串行调工具，多个 session 走不同
  文件。`globalThis` 锁只在并发启动新会话时短暂需要（一次性
  `fs.copyFileSync` 是原子的）。

---

## 6. 实时下发到 UI

文件持久化解决的是"事后怎么查"。要驱动常驻面板，还得有第二条通道：
在一个 turn 流式期间，每一次成功的工具调用都必须在 ~1 帧内更新
React 树，而不是"等下一个 SSE 事件再去问服务端"。

### 方案：搭现有 SSE 通道的便车

`app/api/agent/[id]/events/route.ts` 已经在做 `session.onEvent(encode)`。
我们加一个自定义事件类型，从工具的 `execute` 里 emit 出来，通过
`globalThis` 与前端 SSE 消费端接通，和 `tool_execution_end` /
`message_end` 一起被前端接收。

```
execute(...)
   │
   ├─► readAgentTodoState(sessionId)            // 从 JSONL 末行读当前态
   │
   ├─► applyAgentTaskMutation(state, action, p) // 跑 reducer
   │
   ├─► appendAgentTodoEntry(sessionId, {...})   // 写文件 + fsync
   │                                            // (真源)
   │
   ├─► emitAgentTodoState(sessionId, {          // 内存里推送一次
   │     tasks: newState.tasks,                 // (best-effort, 0 延迟)
   │     nextId: newState.nextId,
   │     action, id?, ts: Date.now(),
   │   })
   │
   └─► return { content, details }              // details 仍是 pi 工具标准
```

`emitAgentTodoState` 是一个微型辅助：往 `globalThis.__piAgentTodoListeners`
这个 `Map<sessionId, Set<fn>>` 里推一条（沿用项目里 `__piSessions`、
`__piStartLocks` 的 `globalThis` 纪律）。SSE 路由在连接时订阅、断开时
退订，每条推送都对应一个 `agent_todo_state` SSE 事件。

### 为什么不"在每个 SSE 事件上重新 `readAgentTodoState`"？

理论上可以：前端在 `agent_todo_state` 事件里只拿 `sessionId`，再去
`GET /api/agent/[id]/agent-todo` 拉一次。但：

- 多一次 HTTP roundtrip，按 turn 内的 todo 变更频率算下来浪费明显。
- 当前态在文件里就是末行一行 JSON，O(1) 可读，但仍然要走一遍
  路由栈（鉴权、JSON 序列化），不如直接 in-process 推。
- fsync 在 emit 之前完成，所以"前端拿到 state"和"文件已落盘"
  永远同步；不存在"推了再读"会读到不一致的窗口。

代价就是多一个事件类型 + 一个微型 listener 注册表。广播是 best-effort：
listener 不在（session 已关闭）时 emit 就是 no-op —— 文件里仍然有
正确记录，下次会话再开再读。

### 一个事件类型就够

**不**发 per-action 事件（`agent_todo_created` / `agent_todo_updated` …
）。整个任务列表规模很小（受 agent 工作记忆约束，现实中 <50 条），前端
reconcile 就是 `setTasks(serverTasks)` —— 简单、无需客户端 reducer、不
会漏事件。这跟 `getRpcSession(id).inner.getAllTools()` 的形态一致：
拉状态，不拉 diff。

---

## 7. 前端集成：右下角圆形按钮 + 紧贴 popover

唯一一个落点 —— **圆形按钮在 chat 区域右下角的 action stack 里，
点击展开紧贴其左上方的 popover，popover 内展示 agent 的 live task
plan**。不再有右栏 tab，也不再在 `MessageView` 内联渲染：popover
与 chat 卡片互不干扰，刻意避免视觉重复。

### 7.1 为什么是按钮 + popover 而不是常驻面板

旧版是一个常驻在对话区左侧空白处的浮动面板（`max-w-820` 居中后，
左侧天然有 sidebar 风格的留白）。重做后改成按钮触发，理由：

1. **不被遮挡的"侧栏位"是稀缺资源**。用户的 left sidebar 已经
   占了一块，留给 chat 的"左侧留白"在窄屏下会消失。按钮模式把
   "是否要看 plan"的选择权交给用户，不用就一直不占视觉空间。
2. **与现有右下角动作栈同规**。session library / collapse all /
   scroll to bottom 已经是这种"小图标 + popover / 反馈"形态，agent
   todo 并入之后右下角统一为"动作 / 启动器"的集合，不再有"两块
   悬浮面板"的视觉分类。
3. **关闭是显式的**。常驻面板"折叠 vs 展开"是隐式状态；按钮
   "开了 / 没开"是一目了然的状态，与 SessionLibrary 同构。

```html
<div class="scrollContainer" style="overflow-y:auto">
  <div class="mx-auto max-w-[820px] px-4">    <!-- 内容居中、左右空 -->
    {messages}
  </div>
</div>
```

左右两侧的空白是天然的"侧边栏位"。`AgentTodoPanel` 挂在外层
scroll container 内、用绝对定位钉在左侧空白处、垂直居中：

```
┌──────────────────────────────────────────────────┐
│ Sidebar │  [todo] │ chat content (max-w-820)     │  ...
│         │  panel  │                               │
│         │ (vert.  │                               │
│         │ center) │                               │
└──────────────────────────────────────────────────┘
```

CSS 关键点（实现期再调，这里只描述定位意图）：

- 容器：放在 chat 滚动容器内，`position: sticky; top: 50%;
  transform: translateY(-50%)`，宽度 240-280px（比 `max-w-820`
  留足余量，不挤到消息流）。
- 横向：用 `left: <calc of sidebar-width + 16px>` 或 `right: auto;
  margin-right: <计算值>`，确保始终落在"chat 容器左内沿"
  与"消息流左沿"之间的留白里。
- 高度：`max-height: 60vh` + 内部 `overflow-y: auto`，避免长
  plan 撑出 viewport。
- z-index：高于 chat 内容，低于 modal / 抽屉 / 命令面板。
- **响应式**：viewport < 1100px（chat 留白不够时）整体隐藏；
  全屏显示时（无 sidebar / 无 right panel）让面板保留，仍
  旧垂直居中。
- **过渡**：plan 从空到非空时 fade-in 200ms；从非空到空
  （`clear` 或会话结束）fade-out 200ms，避免突兀消失。

### 7.2 挂载位置与 popover 定位

挂载点在 `components/ChatWindow.tsx` 的右下角 action stack，是
该栈的**第一颗按钮**（从左到右顺序：AgentTodo → SessionLibrary →
Collapse all → Scroll to bottom）。

按钮和 popover 共用一个 `position: relative` wrapper，所以 popover
可以锚定到 wrapper 的右上角：

```
┌──────────────────────────────────────────────────┐
│  chat content (max-w-820)              ╔═══════╗│
│                                       ║popover║│
│                                       ║       ║│
│                                       ║ tasks ║│
│                                       ║       ║│
│                                       ╚═══════╝│
│                                       ┌───┐     │
│                                       │ ☐ │ ◀── launcher (button) │
│                                       └───┘     │
└──────────────────────────────────────────────────┘
```

具体 CSS：

- **wrapper**：`position: relative`，宽度 = 按钮宽度 = 36px
  （h-9 w-9）。是 flex item，落在 action stack 的第一个槽位。
- **popover**：`position: absolute; bottom: calc(100% + 8px);
  right: 0;` —— 底部距按钮顶部 8px，右侧与按钮右侧对齐。宽度
  256px，高度 `max-height: 240px`（超过则内部滚动）。背景
  `color-mix(var(--bg-panel) 50%, transparent)` + `backdropFilter:
  blur(8px)` —— 跟旧面板同款半透明 + 模糊，让 popover 即使压在
  消息上也不完全遮挡文字。
- `transform-origin: bottom right` 让 scale 从按钮位置"长出来"
  而不是从页面中心放大。
- `z-index: 20`，高于 chat 内容。

### 7.3 Popover 内容

跟旧面板**完全一致** —— 任务按 `id` 升序平铺（不再分组
In progress / Pending / Completed，视觉状态是唯一区分）：

- **in_progress**：`var(--accent)` 文字 + 2.6s linear gradient
  sweep 高亮；下面显示任务的 `description`（最多三行）。
- **completed**：删除线 + `var(--text-dim)`。
- **pending**：默认 `var(--text)`。
- **空状态**：整个组件不渲染（连按钮都不显示），保留旧版的
  "不抢眼"语义。Agent 一开始没调 `agent_todo`，聊天区右下角就
  不会出现这颗按钮。

### 7.4 Launcher 按钮细节

- **图标**：3 行 checklist（每行左侧打勾 + 右侧横线），跟
  SessionLibrary（2x2 网格）/ Collapse all（chevrons）/ Scroll to
  bottom（单 chevron）在视觉上区分。
- **圆点指示**：有 `in_progress` 任务时，按钮右上角显示一个
  8×8 accent 圆点 + 2px `var(--bg-panel)` `boxShadow` 描边，跟
  SessionLibrary 的红 badge 同款"浮在按钮上方"质感。**圆点有
  2.6s scale 1→1.2 / opacity 1→0.7 循环 pulse**，跟 in_progress
  文本的 sweep 同周期，所以"live"在按钮和 popover 内读到的信号
  是一致的。
- **hover**：跟同栈兄弟同规 —— `hover:scale-110`。
- **aria-label / tooltip**：都跟 i18n `Agent Plan` 同键。

### 7.5 动画

- **展开**：外层 popover scale `0.96 → 1.0` + opacity `0 → 1`，
  180ms `cubic-bezier(0.32, 0.72, 0, 1)`。`transform-origin:
  bottom right` 让 popover 从按钮位置"长出来"而不是从页面中心
  放大。
- **内层 body** 仍走 `max-height: 0 ↔ 240px` 过渡 —— 与旧面板
  同款节奏，负责实际的内容高度变化。
- **关闭** 三种路径，任一触发都把 `open` 切 false：
  1. **点同一按钮再点一下**（基础 toggle）。
  2. **Esc** 键。
  3. **mousedown 在 wrapper 外**。但命中
     `[data-agent-todo-stay-open-zone]` 祖先的元素时**不关** ——
     当前 `ChatInput` 最外层 wrapper 打了这个属性，所以用户在
     popover 打开时点聊天输入框参考任务列表打字，popover 不会
     意外关闭。

为什么用 `mousedown` 而不是 `click`：click 在 mousedown 之后
触发，如果 target 上的 click handler 重新打开了 popover（比如
按钮），先 close 再 open 看起来会闪一下。mousedown 先关，后续
click 再开，流程是干净的。

- **popover 始终挂载在 DOM 里**，关闭时只是
  `opacity: 0; transform: scale(0.96); pointer-events: none`。
  这样 toggle 两个方向都走 CSS transition，无需 setTimeout
  控制 unmount 节奏。
- **prefers-reduced-motion**：全部 transition 关闭，光扫 / pulse
  停止，文本恢复 `currentColor`。

### 7.6 响应式

`viewport < 1100px` 时**整个组件（按钮 + popover）都不渲染**，
沿用旧面板的断点 —— 窄屏 chat 没有足够的右侧留白容纳 256px
popover。Agent 在窄屏下仍可正常调 `agent_todo`，只是用户看不到
panel，是显示层的退化，不影响功能。

### 7.7 Hook：`useAgentTodo`

Hook 不再后台轮询。进入已有 session 时执行一次
`GET /api/agent/[id]/agent-todo`；流式期间由 `useAgentSession` 在
`agent_todo` 的 `tool_execution_end` 事件后递增 `refreshKey`，Hook
收到后再执行一次请求。Session 切换 / enabled toggle 时清空当前状态。
新组件复用同一个 hook，数据契约如下：

```ts
export function useAgentTodo(sessionId: string | null, refreshKey: number): {
  tasks:   readonly AgentTask[];   // 当前全部任务
  empty:   boolean;                // true → caller 整个不渲染
  enabled: boolean;                // global toggle, false → 整个不渲染
};
```

### 7.8 与 `MessageView` 的关系

`MessageView` 仍不做特判。`agent_todo` 工具调用以通用 tool-card
渲染：header + 可展开的 input + result text，没有额外 inline
body。理由：

- popover 已是 live 视图，工具调用一 commit 就同步更新；inline
  重复显示是噪声。
- rpiv-todo 的 inline `renderCall` / `renderResult` 是 TUI 专有
  （无独立 panel），到了 web 已经被"按钮触发 popover"取代。
- 想看状态变化历史的人，应当走 JSON 文件 / JSONL endpoint（见第 8 节），
  而不是塞在 chat 流里。

---

## 8. 初始态接口

新增一个 endpoint，**不**是新 RPC 命令 —— 它是读 agent todo 文件：

```
GET /api/agent/[id]/agent-todo
  → 200 { tasks: AgentTask[]; nextId: number; historyCount: number }
  → 404 如果 session 不存在
```

Handler 流程：

1. 不需要 `resolveSessionPath` —— 直接拿 `:id` 当文件名拼路径。
2. `readAgentTodoState(id)` 读末行 → `{ tasks, nextId }`。
3. `readAgentTodoHistory(id).length` 拿行数（用于面板上"查看历史"
   入口的 badge，可选）。
4. 拼成 JSON 返回。文件不存在 = `{ tasks: [], nextId: 1,
   historyCount: 0 }`，**不**报 404（让"未使用过工具的 session"也
   能正常水合）。

这个 endpoint 只服务初始水合（用户打开老会话时一次性拉一次）。
实时更新走 SSE `agent_todo_state` 通道。

可选的姊妹 endpoint（如果未来要做"查看历史"模态）：

```
GET /api/agent/[id]/agent-todo/history
  → 200 AgentTodoLogEntry[]
```

---

## 9. 文件清单

```
lib/
  agent-todo-store.ts                  服务端；JSONL 读写（readAgentTodoState /
                                       readAgentTodoHistory /
                                       appendAgentTodoEntry /
                                       agentTodoPath / copyAgentTodoFile /
                                       deleteAgentTodoFile）
  agent-todo-tool.ts                   服务端；defineTool<Schema, Details>；
                                       内部组合 reducer + store + 推送
  agent-todo-tool-types.ts             客户端可导入：AGENT_TODO_TOOL_NAME、
                                       EMPTY_STATE、类型、countTasks
  agent-todo-tool/
    reducer.ts                         applyAgentTaskMutation — 纯函数
    response-envelope.ts               buildToolResult — 组装 content+details
                                       （完整当前 tasks + error）

app/api/agent/[id]/
  agent-todo/route.ts                  GET — 读 ~/.pi-work/agent-todo/<id>.jsonl
  events/route.ts                      +1 个 case：从 __piAgentTodoListeners
                                       透传 agent_todo_state

app/api/sessions/[id]/route.ts         +DELETE 时 unlink 对应 agent-todo 文件

lib/rpc-manager.ts                     +buildAgentTodoTool() 加进 customTools，
                                       +emit 辅助函数、+connect 时订阅

components/
  AgentTodoPanel.tsx                   右下角圆形按钮 + 紧贴 popover，点击展开任务清单
  ChatWindow.tsx                       挂载 <AgentTodoPanel /> 到右下角 action stack（第一顺位）

hooks/
  useAgentTodo.ts                      session 初始拉取 + refreshKey 触发的按需拉取
  useAgentSession.ts                   在 agent_todo tool_execution_end 后递增 refreshKey

docs/agent-todo/
  design.md                            本文档
```

---

## 10. 生命周期与时序

| 事件                              | 发生什么                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Session 创建                      | `customTools` 包含 `buildAgentTodoTool()`；工具立即可用。文件尚未创建。                                      |
| `agent_todo` 首次调用             | `mkdir ~/.pi-work/agent-todo` + `appendFileSync` 创建文件 + 写第一行。                                         |
| `agent_todo` 后续调用             | 读末行 → reducer → 追加新行 + fsync → emit 实时事件 → 返回 tool 结果。                                       |
| 删 session（DELETE 路由）         | `unlink ~/.pi-work/agent-todo/<id>.jsonl`。                                                                   |
| 流式途中刷新页面                  | `GET /api/agent/[id]/agent-todo` 水合面板（读文件末行）；SSE 重连；实时事件继续。                            |
| 打开不同 session                  | Provider 重新拉 endpoint、重新订阅 SSE。                                                                      |
| Session 闲置 10 分钟              | `AgentSessionWrapper.destroy()` 触发；进程内 state 丢弃，文件不动；下次 reload 重新水合。                      |
| Next.js / 服务重启                | 同上，文件是唯一真源。                                                                                       |
| Compact                           | 不动 agent todo 文件（已与 session `.jsonl` 解耦）。                                                          |

---

## 11. 权衡与风险

**两套 `todo`-ish 系统并存。** 命名距离（`todo_*` vs `agent_todo`）让
它们在模型层、存储层、UI 层都互不干扰。如果某天想做"把 agent 计划
转成用户 todo"的功能，那是另一个路由读一个 store 写另一个 store。

**JSONL 文件会增长。** 每次 `agent_todo` 调用追加一行完整快照，一个
长会话累积下来可能 MB 级。真实的 agent 计划（<50 条、<1KB / 行）相
对对话内容可忽略；如果将来担心，可以让 `stateAfter` 在 reducer 判断
"未变"时省略字段，或者提供 archive 命令把整文件压缩成单个最终快照
（保留最近 N 条 + 最终态）。

**CLAUDE.md "不可逆操作" 精神。** agent-todo 文件处于"用户可追但
非不可替代"的位置（agent 重做会重新生成），但与 `todos.db` / 聊天
记录同一目录。写操作走 `fs.appendFileSync` + `fsync`，不引入
`cat > file` 这种截断惯用法；删 session 走 `fs.unlink` —— 全部走
Node 标准 API。手动 `cat > ~/.pi-work/agent-todo/...`
是用户的责任，与本设计无关。

**自定义事件是自定义的。** SSE 通道已经透传 `session.onEvent` 的所有
东西；我们只是从工具 `execute` 里的旁路 emit 一个合成事件。除了
listener 注册表之外不引入新的服务端基础设施。

**navigateTree 不影响 agent todo。** 用户在同一 session 内切分支
（BranchNavigator / Continue 按钮）走 pi 的 `navigateTree`，session
ID 不变，因此 agent todo 文件路径不变，**新分支看到的是旧分支的
计划**（不重置）。这是与"按会话区分"对齐的代价：分支 ≠ 新文件。
如果将来需要"分支切换重置 plan"，那是另一个功能，不在本文档。

**Compact 与 plan 解耦。** 即使 pi 改了 compact 行为（删 `toolResult`、
限 token 预算等），agent todo 文件不受影响，因为状态不再依赖
session `.jsonl`。这是从分支回放改到文件持久化的最大收益。

**模型可能不用这个工具。** `promptSnippet` / `promptGuidelines` 注入
是唯一抓手。可以对照现有基线（例如"用 TodoWrite 处理复杂任务"）A/B
guidance 文案，但这超出本文档范围。

**窄屏没有面板。** viewport < 1100px 时整个 `AgentTodoPanel`
（按钮 + popover）都不渲染。手机上用户看不到 agent 的 plan，
但 agent 仍能正常使用工具 —— 这是显示层的退化，不影响功能。
如果将来要做 mobile-first，可能要把 launcher 改成一个可下拉的
sheet。

---

## 12. 明确不在本设计内

- **没有 `/todos` slash command。** pi-work 的 chat 输入框没有 slash
  command 表面。web 里 `/todos` 的等价物就是右下角的 launcher
  按钮 + popover。
- **没有"查看历史" UI。** history 数据全在 JSONL 里，可以
  `cat ~/.pi-work/agent-todo/<id>.jsonl | jq`；endpoint
  `GET /api/agent/[id]/agent-todo/history` 也已留好。但不渲染到
  UI —— 历史是给排查用的，UI 上展示反而抢戏。如果将来要做"历史
  抽屉"，可以另起一节。
- **没有子 agent / 并行任务支持。** 一棵任务树对应一个分支。
- **不是用户可编辑的列表。** UI 上只读。agent 是唯一的 writer。
- **不做用户 todo 的迁移路径。** 两套系统保持独立。如果将来要
  "agent plan → user todo"，那是另一个路由读一个 store 写另一个
  store。
- **不持久化到 agent-todo 目录之外的地方。** 删 session 时同步
  删文件（hook 进 DELETE 路由），不会遗孤。
