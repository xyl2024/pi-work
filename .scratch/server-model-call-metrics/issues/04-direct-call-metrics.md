# 04: 翻译与自动起名纳入逐调用查询

**What to build:** 翻译和自动起名的模型调用，无论是否关联持久化会话，都能落库并通过现有逐调用 API 查询三个指标。直接调用复用统一采集规则，同时保持流式翻译和一次性结果读取行为。

Blocked by: 01 — 主聊天调用的三个指标可查询

Status: done

- [x] 从实际翻译入口发起受控流式调用后，业务方继续按原有顺序收到完整输出，审计 API 可查询唯一一条记录及准确的首尾输出时间与最终 TPS。
- [x] 从实际自动起名入口发起一次性调用后，原有结果读取、命名与返回行为保持一致；审计 API 可查询唯一一条正常完成记录及指标。
- [x] 来源标识为直接调用，调用用途明确区分翻译和自动起名；有真实会话关联时保留，无持久化会话时明确表达缺失，不虚构持久化会话或使用伪造会话 ID。
- [x] 无会话关联的调用包含在未指定会话筛选的列表和 total 中；指定会话时只返回实际关联记录。结果排序、分页和 nullable 指标遵循 01 的契约。
- [x] 通过统一模型运行时入口采集，不能因为无磁盘会话不加载扩展而漏记；同时不破坏其不加载工具、项目扩展或项目上下文的既有隔离保证。
- [x] 同一结果既经过流读取又经过最终结果读取时，只记一次，不额外遍历抢占模型流、不漏掉最后输出、不重复触发请求或累加用量。
- [x] 保持取消信号、超时和资源释放行为；新增性能记录不将辅助调用意外加入既有费用汇总统计。
- [x] 设置中的模型连接测试不产生本功能的业务性能记录，既有连接诊断返回行为保持一致。
- [x] 通过受控 SDK、实际直接调用入口或最高可行工厂、真实临时 SQLite 和真实 Request 验证两类调用到查询的完整链路，并验证无会话关联及连接测试排除。
- [x] 不依赖 02 或 03；完成匹配范围的 TypeScript、ESLint 和受控测试，不使用真实模型或用户数据，不启动服务，不改 UI。

## Comments

- 实现：`lib/server/llm-direct.ts` 的直接调用运行时统一走
  `getAuditModelRuntime(...)`，并把该运行时传给 `createAgentSession`，因此翻译与自动起名
  不会再因为自建 `ModelRuntime` 而绕过采集。`resolveDirectModel` 仍使用独立目录读取模型，
  不把“解析模型”当成一次模型调用。
- 用途：翻译入口在原有 `runWithLlmAuditContext` 中补 `purpose: "translation"`；自动起名补
  `purpose: "auto-name"`。两者来源仍为 `direct`，翻译没有持久化会话时 `sessionId` 保持
  `null`，自动起名保留真实会话 id，不伪造会话。
- 验收：新增 `tests/unit/direct-model-call-metrics.test.ts`，用受控 `ModelRuntime` + 真实
  `AgentSession` + 临时 SQLite + 真实 Request 驱动两个 route handler。覆盖：
  - 翻译 SSE 顺序与 `done` 行为不变；查询到唯一一条 `purpose=translation` 记录，
    0/2000/6000/7000、120 tokens 的 TTFT/生成窗口/双 TPS 样本；
  - 自动起名一次性结果与名称清理行为不变；唯一一条 `purpose=auto-name`、带真实会话 id 的记录；
  - 无会话调用出现在未筛选列表和 total 中，按其他会话筛选返回 0；
  - 流式读取与 `result()` 双重收尾只记一次；
  - 取消（翻译请求 abort）保留 TTFT、终态 `cancelled`、两个 TPS 为 null；
  - 一次性调用超时同样记录为 `cancelled`，不伪造指标；
  - 无盘会话仍不加载工具 / 扩展 / skills / prompts / agents 文件 / append system；
  - 模型连接测试不产生 `model_calls` 记录；性能记录不进入既有计费 summary。
- 验证：`tsc --noEmit`；ESLint（改动文件）；`PI_WORK_TEST_SKIP_INSTANCE=1 vitest run`
  （`direct-model-call-metrics` 6 passed，`model-call-metrics` + `model-connection-test`
  一起 47 passed）。按 issue 约束未启动隔离服务，因此未执行需要服务实例的 `pnpm test`
  全量接口测试；未做真实服务商 smoke test。
