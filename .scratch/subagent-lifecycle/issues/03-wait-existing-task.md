# 03: 重新等待已有任务

Category: enhancement
Status: done

**What to build:** 父 agent 在一次创建等待结束后，通过 task_id 重新等待同一子任务，无需重新发送输入或启动新任务。

**Blocked by:** 01: 改名为 subagent，打通创建与独立等待.

**Status:** done

- [x] wait 精确定位当前父会话直属子代理的某次任务，不默认跟随该会话后来的任务。
- [x] 默认有界等待与 spawn 保持一致，支持零等待和缩短等待；超时返回真实当前状态及等待超时标记。
- [x] 已完成或其他终态任务立即返回对应结果、错误和可用的部分输出，不创建或重放回合。
- [x] 多个等待者或重复 wait 不启动新任务，等待取消或到期不取消子任务、不释放执行槽位。
- [x] 通过工具 seam 与可控时钟验证先超时后完成、再次等待、多等待者、终态立即返回及归属校验。

## 实现备注

- 工具新增 `action: "wait"`，只接受 `task_id` 和 `wait_ms`：默认沿用 spawn 的 15 分钟，`wait_ms: 0` 立即返回；它只观察，不会把工具调用的 abort 传给任务管理，所以等待被取消/到期都不会停任务或释放槽位。
- 归属校验收在 `getSubagentTaskForParent`（`lib/server/subagent-queries.ts`）：别人的 task_id 在本人会话下就是「找不到」，`get` 与 `wait` 共用同一条规则。
- 返回结构复用 spawn 的观察详情（`action` 区分 `spawn`/`wait`），带 `taskId`、`childSessionId`、真实状态、`waitExpired`、结果/错误/部分输出；超时文本会提示用 `action:"wait", task_id=...` 再次观察。
- 任务管理 `wait` 先判终态直接返回；非终态但本进程已不管理的行按 `interrupted` 报告，不再复述可能过期的 `running`。已完成/失败任务不会创建或重放回合。
- 测试 `tests/unit/subagent-wait.test.ts` 用真实工具接口 + 真实任务管理 + 脚本化回合 adapter + 可控时钟覆盖：先超时后完成再等待、多等待者、终态立即返回（含错误与部分输出）、同会话新任务不串台、stale 行报 interrupted、等待 abort 不停任务、越权/未知 task_id 与参数校验。
