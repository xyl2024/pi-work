# 交互闸门是一个 module：一张表、两类闸门、不变量靠结构而不靠断言

服务端有两件事需要「一次工具调用停下来等用户」，它们的骨架被写了两遍：`AgentSessionWrapper` 的 `pendingPermissions`（`lib/server/rpc-manager.ts:113-114`、`:491-546`）与 `pendingUserInputs`（`:115`、`:561-650`）。两处都维护同一件事——按 `toolCallId` 存一个未兑现的 Promise、广播一条合成的 SSE 事件、等客户端 POST 回来 resolve、超时或销毁时收摊——两处也都写着同一段「重复请求返回既有 promise」的包装（`:492-499` 与 `:565-572`）。代码里留了一条为这份重复辩护的注释（`:71`）：*「Distinct from `pendingPermissions` because the data shape, lifecycle, and front-end renderer are entirely different.」* 拆开看只有 data shape 站得住：front-end renderer 在客户端，不该成为服务端代码重复的理由；lifecycle 恰恰是同一个（挂起 → 决议 → 收摊），差异只在策略。

重复已经产生三处漂移，且都不是口味问题：

1. **刷新页面时提问会重播，权限确认不会。** 服务端只有 `snapshotPendingUserInputs()`（`:640`），`app/api/agent/[id]/events/route.ts:64-81` 也只重播提问。于是刷新后那个危险命令的确认在界面上再也看不到，而服务端的 Promise 仍在等 `dangerous_patterns.timeout_ms`（默认 5 分钟）把它自动拒绝——agent 收到一个用户从未做出的「拒绝」。
2. **提问没有截止时间。** 权限确认 5 分钟自动 deny；提问没有任何计时器，而回合进行中 idle 回收会被顶掉（`resetIdleTimer` 的 `if (this.isRunning()) return;`，`:453-471`），所以一个没人回答的提问可以让一个回合永远挂着。
3. **「本会话总是允许」是一份裸 `Set<string>`。** `allowedThisSession` 同时收 `codegraph_init` / `codegraph_index` 与用户可配的危险规则名（写点只有 `:540`，读点 `:1326` 与 `:1358`），中间没有前缀也没有类型隔离。

**我们决定**，这条关注点是一个 module（`lib/server/interaction-gates.ts`，按会话一个实例、由 wrapper 持有）：它拥有挂起表（开一张、决议、快照、全部作废）、**调用点的闸门序列**（查本会话备忘 → 子代理一律拒 → 提问 → 解释决定）、重播契约（`snapshot(): SessionEvent[]`，两种闸门都返回线协议事件）与会话级备忘。两个闸门是它的两个 adapter，各自保留类型化的对外名字与线协议不变。

三条边界：

- **表对载荷泛型，不变量不做断言。** 「同一会话至多一个闸门」今天成立，靠的是 pi「先串行 preflight、再并行执行」加上 `ask_user_questions` 声明的 `executionMode: "sequential"`（整批因此降级为串行），而权限确认恰好是在 preflight 阶段提的；这是借来的地基。module 用一张表在结构上让「装不下两个」成立，并把这条假设写在注释里，但**不**为了它抛错——SDK 哪天改了行为，我们要的是降级，不是线上崩溃。
- **module 产出「决定 + 一句拒绝理由」，不产出 pi 的形状。** ADR-0001 要求对子代理说一句话（今天那句在 `subagentPermissionBlock`，`:1064`），所以理由文本是 module 的活；但 `{ block: true, reason }` 是 pi 的扩展返回值形状，由调用点包。这样 module 的测试不需要 SDK 的类型（ADR-0003 规则 3）。
- **配置不进 module。** 超时以 `timeoutMs: number | null` 传入（`null` 即没有截止时间）；`dangerous_patterns.timeout_ms` 原地不动（它属于那组规则），提问的截止时间另开一个键。module 不认识配置文件。

## Considered options

- **只抽挂起表，闸门序列留在两处。** 省下的只是骨架（每份约 30 行），而 `:1326` 与 `:1358` 那份「查备忘 → 子代理拒 → 提问 → 解释决定」仍是第三份复制，任何单点 bug 修复都不会消掉它；ADR-0001 的规则也继续散在两个 `if` 里，只靠 `tests/unit/subagent-profiles.test.ts` 兜着。
- **连客户端的两个队列一起收。** 客户端的两个面是**刻意**不同的交互：权限确认是抢焦点的全屏模态（`PermissionDialog`，portal 到 body），提问是可以滚过去的内联卡片加侧栏小圆点（`AskUserQuestionsPanel` 与按 `sessionId` 分桶的 `askUserQuestionsStore`）。合并它们是在改产品，不是在深化 module。
- **两个类型化闸门各持一张表，只共享一个私有原语。** 读起来各自独立，但「至多一个」这条不变量又回到运气上，且第三种闸门出现时要再抄一次。
- **不建 module，只把三条漂移各自修掉。** 最省，但留下第三份复制与两处 ADR-0001 判定；三次独立修复也仍然要各自摸一遍这两份骨架。

## Consequences

- 这一刀**不是**行为冻结的搬移：它顺手修掉漂移 1（权限确认也会在重连时重播），因此 PR 必须显式列出这条行为变更，而不是声称「什么都没变」。漂移 2（提问的截止时间）与漂移 3（备忘命名空间）各自另开一刀：前者改 agent 的行为，后者改配置语义。
- ADR-0001 的「交互闸门对子代理一律拒绝」从此有一个代码归属地；`ask_user_questions` 那条仍然靠工具集白名单排除（`lib/server/subagent-tool.ts` 的 profile 常量），是另一套机制，本 ADR 不合并它们。
- 重播只有一条路径：route 调 `snapshot()` 并把返回的事件 encode 一遍。客户端侧无需新逻辑——提问靠 reducer 的 `seenAskUserQuestionsToolCallIds.claim` 幂等，权限靠 `hooks/usePendingPermissions.tsx:33-38` 按 `toolCallId` 去重，且 reducer 对 `permission_request` 不写状态（`lib/shared/session-events.ts:642-653`）。
- 探查中发现的一条**未修**缺陷：`resolvePermission` 不校验决定载荷（`dispatch` 里是 `command.decision as PermissionDecision`，`:909`），而调用点只把 `"deny"` 当作拒绝（`:1363`）——一个未知字符串因此等价于**放行**。闸门的默认值不该是放行；本 ADR 只记录它，修它另开一刀。
- 「同一会话至多一个闸门」没有任何代码在守。以后 pi 若并行执行 `ask_user_questions`，两个闸门会同时挂在客户端的两个面上——这是本 ADR 明确接受的风险。
