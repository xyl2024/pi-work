# 07: 重启后对账与安全继续

Category: enhancement
Status: done

**What to build:** 服务重启后，用户和父 agent 能识别中断任务、读取保留历史，并显式继续子会话；不会把遗留 running 记录当作仍在执行或自动重放原输入。

**Blocked by:** 05: 在已有子会话中继续委派.

**Status:** done

- [x] 启动时对未确认仍执行的遗留非终态任务标记中断，包括排队、创建、执行和停止中记录；对账可重复运行。
- [x] 不自动重放任务、不自动唤醒父回合，保留错误/原因、部分输出及已有任务历史。
- [x] get/list 和 UI 正确显示中断，不持续按遗留 running 轮询；中断会话可显式 continue。
- [x] 冷启动恢复创建时受限配置和子代理身份，不套用已更改档案、不扩大工具或权限；档案被删除也不破坏已有完整快照。
- [x] 旧数据快照缺失时仅使用可靠可恢复的受限配置，关键配置不足明确失败，不能默认扩大能力。
- [x] 重启后相同 spawn/continue 请求标识仍去重，不重复执行有副作用的输入；继续新请求正常生成独立任务。
- [x] 通过重新打开临时持久化存储模拟重启，验证迁移幂等、任务对账、历史保留、配置恢复和去重，不读取真实用户数据。

## 实现备注

- 启动对账：新增 `lib/server/subagent-startup.ts`，由 `instrumentation.ts` 在服务启动、处理请求前调用。对账按进程只跑一次（`__piSubagentStartupReconciled`），避免 Next.js 开发热重载再次触发时把本进程仍在执行的任务误标中断；任务管理创建时的同一对账复用这个守卫作为兜底。`hasSubagentStore()` 先判断磁盘上是否已有 `subagents.db`（`PI_WORK_SUBAGENTS_DB` 可覆盖），从未用过子代理的进程不会为了对账凭空建库。`reconcileInterruptedSubagentTasks` 把 `queued` / `creating` / `running` / `stopping` 全部改成 `interrupted`，存储层幂等（终态行、`result` 部分输出、`prompt` 与时间历史都不动）；只有原本没有错误原因的行才写入重启说明，已有原因保留。
- 不自动重放、不唤醒父回合：对账只写数据库；任务管理启动时不会为任何遗留行创建 `RunningTask`，测试用脚本化回合 adapter 断言启动后 `runner.turns` 为 0。`get`/`list` 与 `/api/sessions/[id]/subagents`、`/api/subagents/[sessionId]/activity` 继续使用既有的「有效状态」规则（非终态但本进程未管理 → `interrupted`），界面在终态时停止轮询；中断任务可显式 `continue`（新任务、旧历史不动）。
- 冷启动配置：新增 `lib/server/subagent-restore.ts` 统一「快照 → StartRpcSessionOptions」与旧数据恢复。完整快照（含已删除档案）原样恢复模型、思考强度、工具集、提示词、运行时限；`subagentChildSessionStartOptions` 每次都会再过滤 `subagent` / `spawn_subagent`，冷启动、继续与工具重命名都不能打开递归。`openSubagentChildSession` 与 `continue` 共用同一恢复入口。
- 旧数据（`config_snapshot IS NULL` 或快照损坏）：只使用持久化文件能证明的受限事实——session-tools sidecar 的工具选择、会话文件里记录的模型与思考强度、header 的 cwd。工具选择缺失或为 `all` 时 `continue` 在创建任务前同步报错（不落回 cwd 默认或 `all`），工具选择已知时才会入队；会话文件丢失、无模型、header 无 cwd 会在回合开始前的异步恢复中失败并记录原因，`config_snapshot` 保持 NULL，绝不套用当前档案。可恢复时把结果冻结到新任务行（写入失败说明任务已终态，不再启动回合），后续继续（含再次重启后）复用同一份配置；原提示词与运行时限不可恢复，使用中性提示词与 `DEFAULT_SUBAGENT_TIMEOUT_MS`，恢复说明通过 `notes` 记录到服务端日志。恢复期间收到停止时不会打开子会话或把任务改回运行中。
- `continue` 仍是同步入口（与手动输入竞争 busy 检查），无快照的旧任务先以 `config_snapshot = NULL` 入队，在回合开始前异步恢复并回写快照；已有快照的任务路径不多一次 await，队列交接保持同步。只读打开无法恢复的旧会话时以「无工具 + 中性提示词 + `subagent` 身份」重开（保持子代理不继承 APPEND_SYSTEM 的既有规则），且 `startRpcSession` 新增 `persistToolSelection: false` 避免把空选择覆盖到 sidecar 上，之后的显式 `continue` 仍会明确失败而不是静默降级。
- 去重：`request_id` 的查询与唯一索引本来就在 SQLite（`subagent_tasks.request_id`），重启只丢内存任务管理，不丢去重记录；测试在重启后重试相同 spawn/continue 请求返回原任务且不启动回合，换新 `request_id` 正常生成独立任务，复用到另一个子会话仍被拒绝。
- 测试 `tests/unit/subagent-restart.test.ts`：临时数据根 + 临时 agent dir 模拟重启（丢弃 `__piSubagentsDb` / `__piSubagentTaskManager` / 启动对账守卫后重开同一文件）。覆盖启动对账（四种非终态、终态与部分输出保留、重复对账无变化、无库时不建库）、重启后 list/get 报中断并可显式 continue、快照冷启动（删除档案后仍按快照模型/思考强度/时限/工具运行）、旧数据恢复（含 sidecar 过滤 subagent 工具、结果冻结、二次重启只靠快照）、同步与异步两类明确失败（无工具选择/曾用全部工具在入队前失败；会话文件丢失/无模型/无 cwd 在回合前失败）、恢复期间停止不启动子会话、跨重启 spawn/continue 去重与旧库迁移幂等。
- 未执行人工 UI smoke（仓库约定不擅自启动服务）：中断状态与停止轮询沿用既有状态映射与卡片，仅通过类型检查、静态审查和外部接口测试确认。
