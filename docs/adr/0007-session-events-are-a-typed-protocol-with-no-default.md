# 会话事件是一份带类型的协议，客户端对每条事件要么归约、要么显式声明不处理

服务端经 SSE 能推给客户端的事件有 **28 种**，客户端只处理 **17 种**，其中还有 **2 种服务端从不发送**（`auto_compaction_start` / `auto_compaction_end`），剩下 **11 种收到就当没看见**——包括 ADR-0004 认定的回合终止事件 `agent_settled`。事件类型在本仓声明了两次，两处都是「有个 `type` 字段、其余随便」（`hooks/useAgentSession/types.ts:33-36`、`lib/server/rpc-manager.ts:99-102`），所以读任何 payload 都靠 `as`。pi SDK 本来有一份带类型的 `AgentSessionEvent` 联合（`@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:40-99`），在 wrapper 边界被丢弃（`rpc-manager.ts:221` 用本仓的宽松 `AgentEvent` 接住了它）。

代价落在处理这一侧：`hooks/useAgentSession/events.ts` 那个 363 行的 `switch`（`:138` 起）动了 11 个 `useState`、6 个 ref、5 个 module store、约 6 处发出去就不管的副作用和 5 个外部回调，依赖数组 42 项（`:498-553`），里面还夹了一次内联 `fetch`（`:278-286`），而且**没有任何测试覆盖**。同一批状态还有第二条独立真值路径：`data.ts:184-227` 的 `applyAgentRuntimeState` 写同样六个 sink，于是 `contextUsage` / `contextComposition` 有三个写者。

**我们决定**，会话事件的类型清单就是这份协议本身，放在 `lib/shared`，服务端与客户端共用同一份，**不复用 pi SDK 的 `AgentSessionEvent`**。每一条事件必须二选一：归约进会话运行时状态，或进入一张显式的「知道、但故意不处理」清单；**不设 `default:` 分支**，清单之外的类型必须让编译失败。归约是一个纯 reducer（`lib/shared`，无 React、无 DOM、无服务端 import）：`(state, event) → { state, effects }`。状态包括去重账本与「在飞的工具调用及其参数」；副作用以封闭联合返回，由客户端适配层执行——**三个 module store（流式消息、会话 UI、工具统计）不进状态**，沿用 ADR-0003 对跨标签页共享面的否决。这一刀行为冻结（ADR-0003 规则 2）：屏幕上不可见任何变化，搬移中发现的漂移记为 findings。

## Considered options

- **只把现有 `switch` 搬成纯函数，事件类型不动。** 最小的 diff，也让那段逻辑第一次可测；但输入仍是 `{ type: string }`，测试断不了协议——能测「收到这个事件会怎么变」，测不了「服务端会不会发我没处理的东西」。11 种静默漏掉的事件与 2 个死分支下次照旧。
- **直接用 pi SDK 的 `AgentSessionEvent` 当协议。** 省一份声明，但它不含本项目自己发的 5 类（`session_tree_update`、`prompt_failed`、`permission_request`、`ask_user_questions_request`、路由自报的 `connected`，见 `rpc-manager.ts:339-373,529-540,593-605,701`、`app/api/agent/[id]/events/route.ts:43`），而且 SDK 升级会直接改动本项目的协议。
- **保留 `default:` 分支吞掉未知事件。** 「向后兼容」的错觉更省事，代价是服务端加事件时没有任何地方会响一声。
- **把三个 module store 一并吸进 reducer 的状态。** 状态更集中，但造出 ADR-0003 已经明确否掉的跨标签页共享面——那次否决正是从「庆祝去重集合泄漏到别的会话」来的。

## Consequences

- 服务端新增或删除一个事件类型，客户端会**编译失败**，直到它被归约或被写进忽略清单。这是一次刻意的编译期约束，不是副作用。
- 今天静默穿过的 11 种事件必须逐条表态：`agent_settled`、`turn_start`、`turn_end`、`entry_appended`、`queue_update`、`session_info_changed`、`summarization_retry_scheduled` / `_attempt_start` / `_finished`、`bash_execution_update`、`connected`。**表态不等于改行为**：这一刀只是把「不处理」写下来，不改变它们今天的效果。
- 客户端「在 `agent_end` 收尾、忽略 `agent_settled`」的口径**不在本 ADR 范围内**。它与 ADR-0004 及 CONTEXT.md「回合」的定义（终止于不再有重试、压缩重试或排队续跑）冲突，是一次可见行为变更，另行决定；本 ADR 只保证它不会继续以「忘了」的形态存在。
- `applyAgentRuntimeState` 这条 REST resync 路径**本切片不合并**。合并是后续切片，并在那时处理 `contextUsage` 有三个写者的问题。收敛之后，「会话运行时状态变了吗」才只有一个答案。
- 2 个服务端从不发送的类型（`auto_compaction_start` / `auto_compaction_end`，`events.ts:474,480`）在归约里没有位置，迁移时删除。
- 去重账本从模块级搬进状态：`events.ts:43` 的 `seenCelebrateToolEndIds` 今天是**跨会话共享**的模块级 Set，正是 ADR-0003 记下的那次泄漏；进入会话运行时状态后它按会话隔离。
- `hooks/useAgentSession/types.ts:38-56` 的 `AgentRuntimeState` 与 CONTEXT.md 新增的「会话运行时状态」**不是同一件事**（前者只是 REST 快照的 payload），需要改名，否则这个词条下一次就会被人当成它的定义。
- 本仓仍不引入浏览器测试基建（ADR-0003 规则 3）：reducer 的验收靠 `tests/unit` 直接断三条性质——协议完备（编译器管）、重放幂等（同一条事件喂两遍，状态与 effects 不变，这是 SSE 重连与压缩重放会重放事件所要求的）、终态迁移（起 → 跑 → 收）。
