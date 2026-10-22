# 05: 压缩与分支摘要调用纳入逐调用查询

**What to build:** 手动压缩、自动压缩和分支摘要实际发起的模型调用能通过审计 API 查询三个指标，并与普通聊天调用区分。采集发生在 SDK 生成操作边界，不依赖普通助手消息完成通知。

Blocked by: 01 — 主聊天调用的三个指标可查询

Status: done

- [x] 通过现存手动压缩、自动压缩及分支摘要入口发起的受控模型调用，均产生可查询的逐调用性能记录；未发生模型请求的路径不创建伪调用。
- [x] 记录保留实际服务商、模型、可用会话关联和所属业务来源，用途区分压缩、分支摘要与聊天；不因没有普通助手消息完成通知而漏记。
- [x] 调用使用 01 的同一采集、存储和派生规则；首输出由正文、思考或工具参数的非空增量定义，最终 usage 来自实际模型结果，不从摘要文本长度估算。
- [x] 一次压缩过程若执行多个独立生成操作，应分别记录；摘要生成以外的会话整理、等待或恢复聊天时间不进入单次模型耗时。
- [x] SDK 单次生成内部的请求重试仍属同一次调用；外层摘要流程在生成操作结束后重新发起生成是另一条调用。不改变现存自动压缩和摘要重试策略。
- [x] 不把整个压缩过程或回合耗时充作模型耗时，不把内部调用完成当作回合彻底结束；会话上下文更新与分支导航行为保持一致。
- [x] 用受控 SDK 从实际压缩/摘要入口或最高可行会话工厂驱动验证，配合临时 SQLite 与真实 Request 查询；同时证明完整调用覆盖和正常业务结果保持一致，不能只直接调用采集包装器验收。
- [x] 同一次摘要调用不因摘要事件和统一采集双写产生重复记录；新增性能记录不无意改变原有 Token 审计费用和 summary 覆盖范围。
- [x] 不依赖 02、03 或 04；使用 01 的公共契约与测试边界完成匹配范围的 TypeScript、ESLint 和受控测试，不读取真实会话/用户数据、不调用真实模型、不启动服务、不改 UI。

## Comments

- 实现：SDK 的压缩与分支摘要调用不经过普通助手 `message_end`，但都从
  `AgentSession` 的 `streamFunction` 进入同一个 `ModelRuntime.streamSimple` 边界。
  `lib/shared/model-call-purpose.ts` 用纯规则识别 `completeSummarization` 的请求
  （摘要 system prompt；分支摘要再按 `</conversation>` 之后的固定指令区分），
  `resolveModelCallContext` 在保留 source/session 的同时覆盖 purpose；
  没有命令作用域时仍保留可识别的 purpose，但 session/source 如实为 null/unknown。
- 覆盖：手动压缩（`AgentSession.compact()`）、自动阈值压缩（`prompt()` 前触发）、
  分支摘要（`navigateTree({ summarize: true })`）均记录；`prepareCompaction`
  为空的路径不产生记录。split-turn 压缩的 history / turn-prefix 两次生成
  分别记录，证明“一次压缩过程中的独立生成操作分开计数”。
- 遵循 01 的契约：同一套 TTFT / 生成窗口 / usage 事实与 TPS 派生规则；压缩准备、
  会话整理和等待时间不进入模型耗时；摘要调用不写 `token_calls`，既有费用
  summary 不变。
- 验收：`tests/unit/model-call-purpose.test.ts` 固定请求分类边界（含会话正文误命中
  回归、replaceInstructions 回退）；`tests/unit/model-call-metrics-compaction.test.ts`
  用受控模型运行时、真实临时 SQLite 和真实 Request 驱动压缩/摘要入口到逐调用 API。
- 验证：`tsc --noEmit`、ESLint（改动文件）、`pnpm test`（102 files / 1284 tests passed）。
  未做真实服务商 smoke test（按 spec 不依赖付费模型）。
