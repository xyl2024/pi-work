# 01: 主聊天调用的三个指标可查询

**What to build:** 正常完成的主聊天模型调用能通过现有 Token 审计逐调用 API 查询 TTFT、平均生成 TPS、全程 TPS，以及稳定调用标识、来源、用途和终态。建立统一运行时采集到真实存储与 API 的最小完整链路，供后续业务入口复用。遵循本功能父 spec 中的统计口径和范围。

Blocked by: None (can start immediately)

Status: done

- [x] 从实际主聊天入口发起调用后，逐调用 API 返回稳定的 callId、正常完成终态、服务商、模型、来源、用途、可用的会话关联，以及 ttftMs、generationDurationMs、generationTps、endToEndTps。新增指标不可用时显式为 null。
- [x] 采集边界位于服务端模型运行时的一次逻辑生成操作，不将回合、浏览器事件传输或 HTTP 响应头耗时作为模型输出计时。不增加模型请求，不抢占业务调用方的流或改变最终结果读取方式。
- [x] 起点、首尾有效输出和完成间隔使用同一单调时钟；墙钟仅用于日期、排序和筛选。涉及的既有注释正确说明 SDK 消息时间戳表示请求开始。
- [x] 非空正文、思考和工具参数增量均算有效输出；非空空白增量也算。响应头、心跳、块声明、工具名称声明、空字符串、usage 和完成事件不算。
- [x] 确定性样本：0 ms 开始，2,000 ms 首输出，6,000 ms 末输出，7,000 ms 完成，实际 output 为 120。查询得到 TTFT 2,000 ms、生成窗口 4,000 ms、生成 TPS 30、全程 TPS 120/7。最后的 1,000 ms 收尾等待不进入生成窗口。
- [x] 使用服务商报告的最终 output 用量，不使用字符数或 chunk 数估算，不加入输入、缓存或再次累加 reasoning。单有效输出块的生成窗口为零、生成 TPS 为 null；无有效输出时 TTFT 与生成 TPS 为 null，有有效 usage 和正总耗时仍可算全程 TPS。
- [x] 复用 Token 审计数据库及数据目录覆盖机制，持久化原始时间间隔和用量事实，并统一派生 TPS。存储与契约为无持久化会话、未知用量和失败终态保留表达能力，便于后续切片接入。
- [x] 数据库迁移可重复执行。旧记录、既有总耗时和用量保留；旧记录的新指标为 null，不反推历史指标，不把历史未知状态视为成功。真实旧 schema 的临时数据库升级后可继续读写。
- [x] 新性能记录与旧 Token 审计记录可靠关联，同一次调用只返回一次，原有费用及调用次数不重复累计。callId 不以毫秒时间戳作为唯一依据，不靠时间邻近匹配 HTTP 审计。
- [x] API 保持 rows、total 响应形状及原有时间范围、会话筛选、默认与最大分页约定；按调用开始时间倒序，同时间采用稳定次序，total 使用相同筛选条件。不得新增性能汇总或新的筛选维度。
- [x] 通过受控模型运行时、可控单调时钟、真实临时 SQLite、真实 Request 驱动查询路由，验证采集到 API 的完整结果；覆盖计算样本、有效输出判定、迁移、分页和既有计费兼容，不只测试公式。
- [x] 测试不访问真实模型、密钥或用户目录；运行配置不触发服务启动。完成匹配范围的 TypeScript、ESLint 与测试，不运行构建。所有后续切片复用这一验收边界。
- [x] 不改聊天界面、Token 审计面板视图或 LLM API 审计的 HTTP 尝试语义；不额外存储正文、思考和工具参数。

## Comments

- 实现完成：统一采集边界在 `lib/server/model-call-metrics.ts`，由
  `getAuditModelRuntime` 套在 LLM 审计包装外层；事实写入 `token-audit.db` 的
  `model_calls` 表（`call_id` 唯一，`output_tokens` 可空区分“未报告”与“报告为 0”），
  逐调用查询在 `lib/server/token-audit-store.ts` 合并旧计费行与新性能行。
- TPS 派生规则在 `lib/shared/model-call-metrics.ts`，读写共用一套公式；
  `summarize` 仍只查 `token_calls`，费用/次数不受影响。
- 验收测试：`tests/unit/model-call-metrics.test.ts`（受控 SDK 流 + 可控单调时钟 +
  临时 SQLite + 真实 Request 驱动 `/api/token-audit/calls`），覆盖 0/2000/6000/7000
  样本、输出语义、usage 边界、失败/取消、重复终止、计费兼容、旧 schema 升级和分页。
- 进程内测试用 `PI_WORK_TEST_SKIP_INSTANCE=1` 跳过隔离实例启动（见 `tests/README.md`）。
- 未做真实服务商 smoke test（按 spec 不依赖付费模型）。
