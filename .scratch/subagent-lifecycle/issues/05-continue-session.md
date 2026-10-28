# 05: 在已有子会话中继续委派

Category: enhancement
Status: done

**What to build:** 父 agent 用 session_id 在已有子代理会话中继续委派，保留上下文和每次任务历史；新的任务可像首次创建一样查询、等待和停止。

**Blocked by:** 02: 查询子代理会话、任务详情与结果; 04: 单任务取消与父会话总停止.

**Status:** done

- [x] continue 接受 session_id 和新输入，为一次新回合创建独立 task_id；不覆盖旧输入、结果、错误或时间。
- [x] 成功、失败、取消或中断后的空闲子会话可显式继续；已排队、创建中、执行中或停止中的任务使会话 busy，不自动追加排队输入、打断或 steer。
- [x] 新任务默认等待 15 分钟，支持零等待及缩短等待，与 spawn 的独立等待及后台管理语义一致。
- [x] 每轮重新计算执行时限，使用子会话创建时快照中的模型、推理强度、提示词、工具及运行时限；档案编辑或删除不自动影响已有会话。
- [x] 继续产生的任务进入全局调度，可通过既有 list/get 查询；旧任务结果仍稳定可读，可被 wait/cancel 精确定位。
- [x] continue 校验直属归属并受父总停止入口约束，停止期间拒绝新任务，不能提升权限或启用递归。
- [x] spawn/continue 提供请求标识去重，相同请求重试返回已有任务；不同主动请求即使内容相同也不合并，请求标识不能被用于跨父会话读取/控制。
- [x] 去重记录不依赖单次工具等待内存生命周期；迁移已有记录幂等，为重启后去重保留依据。
- [x] 外部测试验证多轮历史、busy 竞争、独立时限、配置保持、停止门控与重复请求去重，不测试私有内部容器。

## 实现备注

- 工具新增 `action: "continue"`：只接受 `session_id`、`prompt`、可选 `description`/`wait_ms`/`request_id`；默认等待沿用 spawn 的 15 分钟，`wait_ms: 0` 立即返回。归属先走 `getSubagentSessionTaskForParent`，别人的会话在本人上下文里就是「找不到」。
- 每次 continue 由 `subagent-task-manager.continue` 新建一行任务，`child_session_id` 在排队时就写入，旧行的 `prompt`/`result`/`error`/`created_at`/`started_at`/`finished_at` 完全不改。新任务照常进全局队列，可被 `wait`/`cancel` 用新 `task_id` 精确定位，也会出现在 `list`/`get(session_id)` 的同一会话历史里。
- 忙碌判定以任务管理持有的未结束任务为准：同一子会话存在 queued/creating/running/stopping 任务时直接返回 busy（文案在 `SUBAGENT_SESSION_BUSY`），不会排队输入、打断或 steer 当前回合。运行实例已不管理的遗留非终态行是 interrupted，允许显式继续。
- 配置来自 `getSubagentSessionConfigSnapshot`（该子会话最早一条带快照的任务），而不是现在的档案：编辑/删除档案不影响已有会话。继续时通过 `TurnSessionSpec.session = { kind: "reuse", sessionId }` 复用子会话，并再次下发快照里的模型与思考强度；工具、系统提示词在冷启动重开文件时也按快照重建。`timeoutMs` 每轮重新计算，排队时间不计入执行时限。
- 生产子会话获取 `startSubagentChildSession` 支持 reuse：活着就直接接管，活着不存在则按会话文件以 `source: "subagent"` 重开（仍不注册 subagent 工具，递归保持禁用）。
- 总停止窗口（`stoppingParents`）同时拦截 spawn 和 continue；停止确认完成、窗口解除后可再次委派。
- spawn/continue 新增可选 `request_id`：`subagent_tasks.request_id` + `UNIQUE(parent_session_id, request_id) WHERE request_id IS NOT NULL` 持久化去重，先查后插并在唯一索引竞争时回查；迁移只用 `ALTER TABLE`/`CREATE INDEX IF NOT EXISTS`，幂等且旧行保持 NULL。同一 request_id 被 `continue` 复用到另一个子会话时明确报错，避免借去重记录读取/控制别的会话；跨父会话同名 id 互不可见。无 request_id 的两次主动请求即使内容相同也不合并。
- 测试 `tests/unit/subagent-continue.test.ts` 用真实工具接口 + 真实任务管理 + 脚本化回合 adapter + 临时数据根覆盖：多轮历史不覆盖、busy、4 种终态后续继续、默认/零/缩短等待、执行时限来自快照、配置冻结、停止门控、请求去重（含重启后与管理器重启）与跨父会话隔离、归属/参数校验、旧任务迟到取消不影响新任务。
- 未执行人工 UI smoke（仓库约定不擅自启动服务）：继续任务复用既有 subagent 卡片与实时面板，`action: "continue"` 的 details 与 spawn/wait 同形，仅通过类型检查与静态审查确认。
