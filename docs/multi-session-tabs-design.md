# 多会话 Tab 工作区设计

> 状态：需求决策已锁定，尚未实现。
>
> 读者：负责后续实现、评审和测试的 agent。
>
> 本文记录一次完整的需求探索结果。除非产品方重新修改本文中的“已锁定决策”，实现 agent 不应再次改变这些行为边界。

## 1. 一句话结论

Pi Work 需要支持一个页面内同时打开多个会话 tab。每个已打开会话拥有独立的前端 session controller、消息状态和运行状态；只有正在运行的会话保持 SSE。切换 tab 只切换内存中的 active controller，不重新获取已经打开会话的消息或 runtime state，也不会因为切换而断开正在运行会话的 SSE。

## 2. 目标

- 在同一个页面内同时管理多个正式 Agent 会话。
- 不同会话可以同时运行；切换 tab 不会中断任何正在运行的会话。
- 切回后台运行会话时，直接恢复其增量文本、工具输出、运行阶段和滚动位置。
- 已打开会话之间切换时，不重新请求会话消息、context 或 runtime state。
- 保留每个会话自己的输入草稿、图片附件、模型、thinking level 和工具选择。
- 让会话 tab 与现有右侧文件/工具 tab 保持清晰的生命周期边界。
- 以同时运行 5～10 个会话作为第一版验收基线。

## 3. 明确不属于本次需求的内容

- 不在多个浏览器刷新之间恢复整个 tab 集合。
- 不做跨会话权限请求或用户问答提醒系统。
- 不自动切换到产生事件的后台 tab。
- 不做全局 multiplex SSE 或 WebSocket。
- 不做 worktree、branch、sandbox 或容器隔离。
- 不限制多个会话使用同一个 cwd / worktree。
- 不支持同一个 session 内排队多个并发 prompt。
- 不把右侧工具面板改造成按会话独立的完整工作区。
- 不要求第一版提供 tab 拖拽排序、复杂未读数、快捷键体系或动画细节。

## 4. 术语

| 术语 | 含义 |
|---|---|
| 正式 session | 已经有服务端 session id 和 session 文件的 Agent 会话 |
| draft | 尚未发送首条消息、尚未通过 `/api/agent/new` 创建正式 session 的客户端新会话 |
| session tab | 顶部会话 tab。正式 session 和 draft 都可以对应一个 tab |
| controller | 一个 tab 的独立状态和副作用所有者，负责消息、SSE、命令、草稿和运行状态 |
| active tab | 当前正在显示的会话 tab。只有它的 `ChatWindow` 视图挂载 |
| hydration | 首次打开、重新打开或断线恢复时，从服务端读取会话内容和 runtime state |
| 补偿同步 | SSE 断线重连后，通过 context/runtime 请求补回可能漏掉的事件 |

## 5. 已锁定的产品决策

### 5.1 Tab 打开和生命周期

1. **侧边栏点击行为**
   - 点击侧边栏、搜索结果、收藏或其他入口中的正式 session 时：
     - 如果该 session 已有 tab，只激活原 tab；
     - 如果没有 tab，新建 tab 并激活；
     - 不创建重复 tab。
   - tab 的创建顺序是打开顺序，不按侧边栏修改时间自动移动。

2. **Tab 排列**
   - 新 tab 永远追加到最右侧。
   - 激活 tab 不改变排列顺序。
   - 关闭 tab 后其他 tab 的相对顺序保持不变。

3. **关闭 tab**
   - 关闭 tab 不发送 `abort`。
   - 如果 Agent 正在运行，服务端 Agent 继续运行；关闭只销毁前端 controller 和 SSE。
   - 关闭当前 tab 时，优先激活右侧相邻 tab；没有右邻居时激活左邻居。
   - 关闭最后一个正式 session 时：
     - 有现成 draft 就激活 draft；
     - 没有 draft 就用被关闭 session 的 cwd 创建一个 draft。
   - 有未发送文本或图片附件的 tab，关闭前必须确认；确认后丢弃草稿，取消则保留 tab。
   - 没有未发送内容的 tab 可以直接关闭。

4. **Draft 数量**
   - 同时最多一个尚未发送首条消息的 draft tab。
   - 正式 session 可以有多个 tab。
   - draft 不会在创建时立即产生服务端 session，避免产生没有消息的幽灵 session。
   - draft 首次发送成功获得真实 session id 后，原 tab 原地升级为正式 session tab，不创建第二个 tab。

### 5.2 页面刷新和 URL

1. 页面刷新后不恢复整个 tab 集合。
2. URL 使用 `?session=<sessionId>` 表示 active session。
3. tab 切换时使用 `router.replace` 更新 URL，不使用 `push`，避免每次切换污染浏览器后退历史。
4. 页面首次加载：
   - 有 `?session=A`：只打开并激活 A；
   - 没有 session 参数：创建一个 draft。
5. 侧边栏中其他历史 session 或正在运行的 session 不会自动打开。
6. 刷新时其他服务端 Agent 可以继续运行，但当前页面不会自动恢复它们的 SSE；用户重新打开时再 hydration，并在必要时连接。

### 5.3 SSE 和 Agent 运行状态

1. 使用现有的按 session SSE：

   ```text
   /api/agent/[id]/events
   ```

2. 不做全局 multiplex SSE，不改成 WebSocket。
3. **只有正在运行的 Agent 需要保持 SSE**：
   - Agent 运行中、流式输出、工具调用、compact、等待权限或等待用户问答时，SSE 必须保持；
   - 用户切换 tab 不得关闭或重连该 SSE；
   - Agent 进入 idle 后，完成最后一次状态同步，可以关闭 SSE；
   - idle tab 只保留 controller 内存状态，不维持无意义的 SSE。
4. 发送新消息或执行 compact 前，controller 必须确保该 session 已建立 SSE，然后再发送命令。
5. 打开一个已有 session 时：
   - 允许做一次 hydration；
   - 如果 runtime state 表示正在运行，立即建立 SSE；
   - 如果 idle，不建立 SSE。
6. 关闭 tab 时关闭浏览器侧 SSE，但不得因为 HTTP/SSE 客户端断开而 abort 服务端 Agent。
7. SSE 断线时自动重连，并做一次补偿同步：
   - 重新连接 SSE；
   - 读取会话 context；
   - 读取 Agent runtime state；
   - 按 entry id、tool call id 和 controller 版本去重合并；
   - 恢复后继续接收实时事件。
8. 正常 tab 切换不触发上述 hydration 或补偿请求。

### 5.4 并发规则

1. 不同 session 可以同时运行：

   ```text
   Session A: running
   Session B: running
   Session C: idle
   ```

2. 同一个 session 内仍一次只允许一个 turn。
3. 每个 session 独立维护：
   - `agentRunning`；
   - streaming 状态；
   - compact 状态；
   - abort 命令；
   - retry 状态；
   - SSE 和重连状态。
4. 不得把 busy 状态提升成全局锁，否则会失去多会话并行的核心价值。
5. 第一版目标是同时运行 5～10 个 session；暂不增加用户可见硬上限。

### 5.5 实时显示和草稿

切回运行中的后台 tab 时必须恢复完整实时视图，包括：

- assistant 增量文本；
- thinking 增量；
- 工具调用开始、参数和运行中输出；
- 已完成的工具结果；
- 当前 Agent phase；
- 当前会话自己的滚动位置；
- 不出现重新加载会话的 loading 页面。

每个 tab 独立保存：

- 未发送文本；
- 图片附件；
- 至少文本光标位置；
- 输入相关的 slash 选择状态；
- 模型、thinking level 和工具选择。

图片附件可以只在 controller 中保存原始 data 和 mime type，视图重新挂载时重新创建 preview URL；关闭 tab 时释放预览资源。

### 5.6 Agent 控制项

模型、thinking level 和工具选择全部按 session/tab 隔离。

- 修改 Session A 的模型不影响 Session B；
- 切换 tab 时恢复目标 session 自己的控制项；
- 模型目录、provider 配置、模型名称等公共元数据可以在 workspace 级共享；
- “当前选中的模型/等级/工具集合”必须属于 session controller。

### 5.7 Tab 栏和右侧面板

1. 新增独立的会话 tab 栏，放在中心聊天区域上方。
2. 现有 `components/TabBar.tsx` 的文件/工具 tab 保持独立，不与会话 tab 混合。
3. 右侧面板布局全局共享：
   - 切换 session 时，当前右侧 tab 不重置；
   - 会话树、工具统计、Token 审计等内容跟随 active session；
   - Todo、收藏、翻译、Canvas、RSS 等全局内容保持全局；
   - Git Diff、文件查看等 cwd/session 相关内容读取 active session 的上下文。
4. 不要把右侧面板扩展成每个 session 一套完整工作区，除非未来另有需求。

### 5.8 Tab 标题和状态

Tab 标题与现有侧边栏统一：

```text
session.name
  -> session.firstMessage 截断
  -> session.id 前缀
```

- draft 显示“新会话”，可通过 tooltip 显示 cwd；
- 重命名和自动命名后，tab 标题实时更新；
- draft 首次发送后标题原地升级；
- tab 显示最小化的被动状态：运行中、后台完成、错误；
- 不弹跨会话通知，不自动抢焦点，不自动切换 tab；
- 状态字段必须来自 controller，不得在切换 tab 时重新请求才能得到。

### 5.9 权限和用户问答

本次不扩展跨会话提醒能力：

- 后台 tab 的权限请求或用户问答不自动弹到当前视图；
- 不自动切换到请求所在 tab；
- Agent 可以保持阻塞和运行状态；
- 用户切回对应 tab 后再看到并处理；
- 关闭 tab 后如果 Agent 继续运行，不保证前端即时提醒；重新打开时再同步可获得的 pending 状态。

这意味着后台阻塞可能不被用户立即注意到，是已接受的产品边界，不要在本次实现中偷偷加入全局提醒队列。

### 5.10 共享 cwd / worktree

用户明确选择：**不限制多个会话共享同一个 cwd / worktree。**

因此第一版：

- 不加 cwd 级锁；
- 不做冲突检测；
- 不弹共享 worktree 警告；
- 不自动创建 worktree 或 sandbox；
- 允许多个 session 同时执行 `edit`、`write`、`bash`。

这是明确接受的并发修改风险，而不是系统提供的安全保证。两个 Agent 可能互相覆盖文件、产生冲突补丁或同时操作 git 工作树。实现和文档都不能声称同一 cwd 下的并行修改是安全的。

## 6. 当前代码探索所得的关键事实

### 6.1 AppShell 当前只有一个聊天实例

`components/AppShell.tsx` 当前通过以下状态表达聊天页面：

- `selectedSession`；
- `newSessionCwd`；
- `sessionKey`。

切换 session 会改变 `sessionKey`，从而卸载并重新挂载 `ChatWindow`。这正是当前会话状态、SSE 和输入内容会被切断的根源。

改造后不能继续把“当前 session”作为唯一的 AppShell 状态；需要引入 workspace 层的 tab 集合和 active tab。

### 6.2 useAgentSession 持有大量必须迁移的状态

`hooks/useAgentSession.ts` 当前在 hook 实例内持有：

- `data`、tree、leaf、messages、entryIds；
- `streamState.streamingMessage`；
- `inFlightToolResults`；
- `agentRunning`、`isCompacting`、`agentPhase`；
- `contextUsage`、`systemPrompt`、session stats；
- model、thinking level、tool selection；
- retry 信息；
- `EventSource`；
- 输入历史和 session 级 command handler；
- 权限、问答、show-file 等事件相关 scratch state。

这些不能随着 active `ChatWindow` 卸载而消失。它们应由每个 session controller 持有，`ChatWindow` 只作为当前 controller 的视图和命令入口。

### 6.3 当前 sessionUiStore 是单例

`hooks/sessionUiStore.ts` 当前是 module-scoped singleton，供 `ChatWindow` 写入、`AppShell` 读取。它包含：

- branch tree / active leaf；
- system prompt；
- stats；
- context usage；
- streaming / agent running；
- branch leaf handler；
- command palette 的 agent controls。

多 controller 并存时，不能让所有 controller 直接写同一个 singleton。推荐做法是：

- workspace store 按 session 保存完整状态；
- 只有 active controller 将 session UI snapshot 投影到现有 `sessionUiStore`；
- active tab 变化时切换投影；
- agent controls、leaf handler 等 imperative bridge 也必须按 active controller 注册和清理；
- 不要让后台 controller 覆盖当前顶部栏或命令面板的状态。

### 6.4 当前 ChatInput 的草稿是组件本地状态

`components/ChatInput.tsx` 当前本地保存：

- 文本 value；
- cursor position；
- 图片附件；
- slash 选择和菜单状态；
- 输入历史游标；
- 模型、工具、thinking 控件的局部 UI 状态。

至少文本、附件和必要的输入上下文必须迁移到 session controller 或受控的 session draft store。下拉菜单是否在切换时保持打开属于实现细节，不是产品契约。

### 6.5 当前 SSE 是按 session 的独立连接

`app/api/agent/[id]/events/route.ts` 已经提供按 session 的 SSE：

- 连接时发送 `connected`；
- 订阅对应 `AgentSessionWrapper`；
- 发送一次 `session_tree_update`；
- 重新发送 pending user input；
- 每 30 秒发送 heartbeat；
- 客户端断开时取消订阅并结束 stream。

本需求应复用该合同，不需要新增全局事件协议。

### 6.6 服务端 wrapper 注册表已经支持多个 session

`lib/rpc-manager.ts` 使用 `globalThis.__piSessions` 保存多个 `AgentSessionWrapper`，并用 `__piStartLocks` 防止同一 session 并发启动。wrapper 有 10 分钟 idle destroy 机制。

客户端关闭 SSE不应调用 Agent abort。服务端 wrapper 是否仍存活由现有 idle 生命周期决定；客户端 controller 生命周期和服务端 Agent 生命周期必须保持独立。

### 6.7 现有 TabBar 属于右侧工具面板

`components/TabBar.tsx` 的 `Tab` 类型包括 file、todo、favorites、translate、toolCalls、json、canvas、rss、tokens、gitDiff、conversationTree、llmAudit、terminal 等。它不是会话 tab，不能直接复用为混合 tab 集合。

### 6.8 现有标题规则在 SessionItem

`components/SessionItem.tsx` 当前使用：

```ts
session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12)
```

会话 tab 应与这个规则保持一致。

## 7. 推荐的实现结构

### 7.1 Workspace 层

建议新增一个 workspace 级模块，例如：

```text
hooks/sessionWorkspaceStore.ts
lib/session-controller.ts
```

名称可以按实现者最终判断调整，但职责必须分开：

```text
SessionWorkspace
  ├─ tabOrder: [tabA, tabB, draftC]
  ├─ activeTabId
  ├─ tab metadata / title / status
  └─ controllers: Map<tabId, SessionController>
```

workspace 负责：

- 创建、激活、关闭 tab；
- 去重正式 session；
- draft 升级为正式 session；
- tab 顺序和 active tab；
- URL 同步；
- 关闭后的邻接 tab 选择；
- 对 AppShell 暴露当前 tab metadata 和被动状态。

### 7.2 SessionController 层

每个正式 session controller 至少需要拥有：

```text
identity
  tabId
  sessionId
  SessionInfo

conversation
  messages
  entryIds
  entryTimestamps
  tree
  activeLeafId
  compactionPoints

streaming
  streamingMessage
  inFlightToolResults
  tool call name/args scratch state
  agentPhase
  agentRunning
  isCompacting
  retryInfo

runtime
  contextUsage
  systemPrompt
  sessionStats
  model
  thinkingLevel
  toolSelection
  availableTools

input
  draft text
  attached images
  cursor position / minimal input context
  user message history

transport
  EventSource or null
  connection state
  reconnect attempt / timer
  controller generation / epoch

pending
  per-session permission state
  per-session ask-user state
  other event-derived pending state
}
```

不要求把每个现有字段机械复制成同名对象，但不能把后台会话所需的状态留在 active `ChatWindow` 的 hook 闭包中。

### 7.3 Active view 层

只挂载一个 active `ChatWindow`：

```text
AppShell
  ├─ SessionTabBar
  ├─ ActiveChatWindow(controller=activeController)
  └─ existing right panel
```

`ChatWindow` 应通过 controller adapter 读取和派发动作。切换 tab 时：

- 不创建第二个完整 `ChatWindow`；
- 不让旧 controller 的 cleanup 关闭新 controller 的连接；
- 只卸载视图层订阅和 DOM；
- controller 和正在运行的 SSE 继续存在。

### 7.4 SSE 生命周期状态机

可采用如下概念状态：

```text
no-controller
  -> hydrated-idle
  -> connecting
  -> running
  -> reconnecting
  -> running
  -> agent-ended
  -> hydrated-idle
  -> closed
```

关键不变式：

- tab 切换不改变 transport 状态；
- `agent_end` 后完成最终状态同步，再关闭 SSE；
- 关闭 tab 才销毁 controller 的浏览器连接；
- 每个 controller 最多一个有效 EventSource；
- 旧连接的回调必须通过 generation/epoch 校验，不能污染新连接；
- 重连后的补偿请求可以读取 session context/runtime，但普通切换不可以。

## 8. 请求边界

### 正常打开/切换

| 场景 | 允许请求 |
|---|---|
| 首次打开历史 session | 允许一次 `/api/sessions/[id]?includeState` 等 hydration 请求，并按 runtime state 决定是否连 SSE |
| 切换到已经打开的 session tab | 不请求消息、context 或 runtime state；只切换 controller |
| 切换到已有 draft | 不请求 session 数据 |
| draft 首次发送 | 允许 `POST /api/agent/new`，并把 draft 升级为正式 tab |
| 关闭后重新打开 session | 允许重新 hydration 和必要的 SSE 连接 |
| SSE 断线恢复 | 允许 context/runtime 补偿同步 |
| 公共模型目录、slash commands 等 | 可以按现有缓存或按需策略处理，不属于“会话数据切换”硬约束 |

以下请求不得因为普通 tab 切换而重新发起：

- `/api/sessions/[id]`；
- `/api/sessions/[id]/context`；
- `/api/agent/[id]`；
- 任何用于重新构造已打开会话消息或 runtime 状态的请求。

## 9. 事件合并和可靠性要求

SSE 是实时传输，不是可靠日志。实现必须考虑以下情况：

- 同一事件因重连被重复收到；
- `message_update` 在 `message_end` 前后到达；
- `tool_execution_update` 与最终 tool result 交错；
- 旧 EventSource 在关闭后仍有延迟回调；
- `agent_end` 和最后一次 `message_end` 的状态更新顺序；
- 断线期间 session 文件已经持久化但浏览器没有增量事件。

建议：

1. 按 entry id 管理已完成消息；
2. 按 toolCallId 管理 in-flight tool result；
3. 用 controller generation 标识当前 transport；
4. 重连补偿后再接受新一轮增量事件；
5. 不要简单地对所有 `message_end` 做无条件数组 append；
6. 最终持久化 context 是已完成消息的权威来源，增量状态只在 turn 运行期间覆盖展示。

## 10. 被明确接受的风险和限制

这些不是待办漏洞，而是本需求的显式边界：

1. **同一 worktree 并发修改不受保护**
   - 多 Agent 可能互相覆盖文件或冲突操作 git。
2. **刷新丢失非 active tab 的前端内存状态**
   - 服务端任务可以继续，但其他 tab 的草稿、增量显示和连接不会自动恢复。
3. **后台权限/问答可能不被立即发现**
   - Agent 可以一直阻塞，直到用户主动切回或重新打开。
4. **没有用户可见的 tab 数量硬上限**
   - 5～10 个是验收基线，不是强制上限。
5. **服务端进程重启问题不在本需求范围**
   - 现有 in-process AgentSession 的生命周期限制保持不变。
6. **同一个 session 在多个浏览器窗口中同时打开的协调**
   - 本需求只保证单页面 workspace 内的 tab 行为；跨窗口命令竞争不新增解决方案。

## 11. 实现顺序建议

### Step 1：定义 workspace 和 controller 契约

先写纯状态和生命周期测试，不改视觉层。确定：

- tab reducer；
- active tab；
- 正式 session 去重；
- draft 升级；
- 关闭后的邻接选择；
- dirty draft 关闭确认所需状态。

### Step 2：抽取 session controller

把 `useAgentSession` 中的 session 级状态、事件 reducer、SSE 生命周期和命令发送逻辑移到可按 session 实例化的 controller。保留 React hook 作为 active view adapter，而不是状态所有者。

### Step 3：实现 lazy SSE 和重连补偿

实现：

- running 才连接；
- tab 切换不触碰连接；
- `agent_end` 后同步并关闭；
- 断线重连；
- context/runtime 补偿；
- stale connection generation 防护。

### Step 4：接入 active ChatWindow

让 `ChatWindow` 只渲染 active controller，确保：

- 后台 controller 不因视图卸载而停止；
- 当前顶部栏只读取 active controller；
- sessionUiStore 和 command palette bridge 不被后台 controller 覆盖。

### Step 5：添加独立会话 tab 栏

实现：

- tab 排列；
- 激活和去重；
- close fallback；
- title/status；
- URL `replace`；
- draft tab；
- dirty draft confirmation。

### Step 6：迁移输入和右侧面板边界

- 迁移每 tab 的文本、附件和必要输入状态；
- 保持右侧工具 tab 独立；
- 让会话相关右侧内容读取 active controller；
- 清理现有 module singleton 对后台 controller 的直接写入。

### Step 7：验证和回归

至少覆盖下方验收清单，再运行仓库规定的 typecheck 和变更文件 lint。

## 12. 验收清单

### 并行运行

- [ ] 打开 Session A，开始运行。
- [ ] 打开 Session B，开始运行。
- [ ] 切换 A/B 多次，A 和 B 的 SSE 都不因切换而关闭或重连。
- [ ] A 的后台增量文本、工具输出和最终消息不丢失。
- [ ] A 运行时切到 B，B 仍可独立发送消息。
- [ ] A 和 B 各自的 abort、compact 和 busy 状态互不影响。

### 空闲连接

- [ ] 打开一个 idle 历史 session 时不因打开动作常驻 SSE。
- [ ] 对 idle session 发送消息时先建立 SSE，再发送 prompt。
- [ ] 收到 `agent_end` 并完成最终同步后，SSE 可以关闭。
- [ ] 后续再次发送时可以重新建立连接。

### 切换请求边界

- [ ] 已打开 tab 之间切换不请求 session context 或 runtime state。
- [ ] 首次打开、关闭后重新打开、断线恢复可以请求。
- [ ] 切换时不显示 session loading 页面。

### 断线恢复

- [ ] 运行中 SSE 断线会自动重连。
- [ ] 断线期间落盘的消息会通过补偿同步恢复。
- [ ] 重连重复事件不会重复显示消息或工具结果。
- [ ] 旧连接延迟回调不会污染新 controller。

### Tab 和草稿

- [ ] 侧边栏重复点击已有 session 不创建重复 tab。
- [ ] 新 tab 追加到最右侧。
- [ ] 关闭 active tab 按“右邻居、左邻居、draft/新 draft”规则选择。
- [ ] 未发送文本和图片附件在 tab 切换后恢复。
- [ ] 关闭 dirty tab 会确认，取消后草稿不丢。
- [ ] draft 首次发送后原地变成正式 session tab。

### 刷新和 URL

- [ ] 切换 tab 使用 `replace` 更新 `?session=`。
- [ ] 刷新只恢复 URL 中的 session。
- [ ] 其他正在运行的服务端 Agent 不因刷新被 abort。
- [ ] 其他 tab 不会被错误地自动恢复或自动建立 SSE。

### 状态隔离

- [ ] 模型、thinking level、工具选择按 session 隔离。
- [ ] session tree、tool stats、token audit 等内容跟随 active session。
- [ ] Todo、RSS、Canvas 等全局面板不被 session 切换破坏。
- [ ] 后台状态只显示被动标记，不自动弹窗或抢焦点。

### 已接受风险

- [ ] 同一 cwd 的多个 Agent 可以同时执行命令，不存在隐式锁或警告。
- [ ] 文档和 UI 没有声称共享 worktree 被隔离或自动合并。

## 13. 相关代码位置

| 文件 | 当前职责 | 多会话改造关注点 |
|---|---|---|
| `components/AppShell.tsx` | 当前 session、URL、右侧面板和 `ChatWindow` 挂载 | 引入 workspace/tab 层，保留右侧面板边界 |
| `hooks/useAgentSession.ts` | session 加载、SSE、事件 reducer、Agent 命令 | 抽取为 per-session controller，hook 变成视图 adapter |
| `hooks/sessionUiStore.ts` | 当前 session UI 单例桥接 | 只允许 active controller 投影 |
| `components/ChatWindow.tsx` | 聊天视图和 active session hook | 只挂载 active view |
| `components/ChatInput.tsx` | 输入、附件、模型和工具控件 | 草稿/附件改为按 tab 保存 |
| `components/TabBar.tsx` | 右侧文件/工具 tab | 不要与新会话 tab 混用 |
| `components/SessionItem.tsx` | 侧边栏标题和重命名 | 复用标题规则 |
| `app/api/agent/[id]/events/route.ts` | 按 session SSE、heartbeat、pending 重发 | 继续复用，不做全局 multiplex |
| `app/api/agent/[id]/route.ts` | session command 和 runtime state | 继续按 session 调用 |
| `lib/rpc-manager.ts` | Agent wrapper registry、idle destroy、事件总线 | 保持 server Agent 与 client tab 生命周期独立 |
| `lib/session-reader.ts` | session 文件和 context 读取 | hydration / 补偿同步的权威来源 |
| `lib/types.ts` | shared session/message 类型 | 增加 controller/workspace 类型时保持 client-safe |

## 14. 实现时的仓库约束

- 新增前端用户可见字符串必须经过 `hooks/useI18n.tsx`。
- 新的服务端交互遵循现有 toast、错误处理和 `sendAgentCommand` 模式。
- 不要把 server-only 的 pi SDK import 带入 client controller 或 client-safe 类型文件。
- 修改后必须运行：

  ```bash
  node_modules/.bin/tsc --noEmit
  node_modules/.bin/eslint <files-you-changed>
  ```

- 开发阶段不要运行 `next build`，不要启动、重启或触碰共享生产服务。
- 实现应保持改动集中在 workspace/controller、active ChatWindow、会话 tab 和相关状态桥接，不顺带重构无关模块。
