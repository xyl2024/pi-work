# 03: 子代理、定时任务与频道调用可按来源识别

**What to build:** 子代理、定时任务和频道/微信入口触发的模型调用，使用与主聊天相同的三个指标口径，并通过审计 API 保留正确的来源、用途和会话关联。共享主聊天路径的业务入口也必须从实际调用工厂验收，不能仅以包装器测试推定已覆盖。

Blocked by: 01 — 主聊天调用的三个指标可查询

Status: done

- [x] 子代理、定时任务、频道和微信现存业务入口触发的每次正常模型调用，都能在逐调用 API 查询到对应指标、服务商、模型和实际会话关联。
- [x] 子代理与定时任务保留各自来源；频道/微信用途与普通聊天可区分。来源和用途分别表达，新来源不会在映射时被静默归为用户聊天。
- [x] 通过已有后台回合执行与会话工厂接入同一模型运行时采集边界，不为各入口另写计算公式或依赖回合耗时推导模型耗时。
- [x] 一次助手工具调用前的模型请求和工具执行后的新模型请求产生两条独立记录，模拟的工具等待时间不进入两次模型调用的耗时。
- [x] 后台调用与主聊天或其他后台调用同时进行时，可按会话筛选得到正确记录，未筛选查询不遗漏后台调用，分页 total 与行数一致。
- [x] 不改变既有回合等待彻底结束、截止时间、取消、会话获取/销毁、消息投递及工具权限语义；调用结束不被误当作整个回合结束。
- [x] 使用受控 SDK 驱动实际入口或最高可行服务端工厂，配合临时 SQLite 和真实 Request 查询，以参数化样本验证各业务来源、用途、指标及工具前后调用划分。
- [x] 既有 Token 审计费用和次数不重复，新增业务归属不会无意扩大费用汇总范围。测试不触发真实定时任务、消息发送或后台监听。
- [x] 不依赖 02 的实现细节，复用 01 已公开的终态与 nullable 契约；完成匹配范围的 TypeScript、ESLint 和受控测试，不访问用户数据或擅自启动服务。

## Comments

- 实现：`AgentSessionWrapper.send(command, { purpose })` 把用途写入 ALS 上下文；
  `RunTurnSpec.purpose` → `runTurn` 只把 purpose 附在 `prompt` 命令上（`set_model` /
  `set_thinking_level` 不携带），`runTurnRpcSession` 原样转发。微信入站固定
  `source: "user"` + `purpose: "channel"`，冷启动与复用分支一致；子代理、定时任务继续
  沿用会话创建时的 `source`（`subagent` / `scheduled`），用途保持默认 `chat`。
- 用途选项抽成 `lib/shared/token-audit-types.ts` 的 `ModelCallCommandOptions`，避免
  rpc-manager 与 turn 模块各写一份同构类型。
- 验收测试：
  - `tests/unit/model-call-metrics.test.ts` 新增后台来源参数化样本（scheduled /
    subagent / channel）：真实 `AgentSessionWrapper` + 真实 turn 模块 + 可控单调时钟 +
    临时 SQLite + 真实 Request 驱动 `/api/token-audit/calls`，断言来源、用途、会话、
    provider/model、TTFT/生成窗口/双 TPS；另覆盖工具前后两次独立调用（工具等待不进入
    任一耗时）、主聊天 + 两个后台并发交错、会话筛选、分页 total、`summarize` 不被
    性能记录重复计入，以及 `runTurnRpcSession` 复用路径的 channel 用途。
  - `tests/unit/wechat-inbound-call-purpose.test.ts` 直接驱动微信入站适配器，钉住
    冷启动与复用都向 `runTurnRpcSession` 传 `source: "user"` / `purpose: "channel"`。
  - `tests/unit/turn-orchestrate.test.ts` 钉住 purpose 只附在 prompt 命令上。
- 验证：`tsc --noEmit`、ESLint（改动文件）、上述单文件 vitest 全过；
  `PI_WORK_TEST_SKIP_INSTANCE=1 vitest run` 为 92 files / 1248 tests passed，
  10 个接口测试文件因未启动隔离实例而 ECONNREFUSED（按 spec 不擅自启动服务）。
  未做真实服务商 smoke test。
- 备注：频道回合内部由 SDK 发起的压缩/分支摘要如何归属，由 05 切片处理；本切片只负责
  业务入口的 source/purpose 接线。
