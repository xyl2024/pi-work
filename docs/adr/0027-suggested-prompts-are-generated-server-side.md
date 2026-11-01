# 建议问题是服务端在 turn 结束后产出的派生数据

「建议问题」是输入框空着时那条占位提示：用户接着最可能问的一个问题。它需要一次独立的模型调用，输入是会话 JSONL 的活动路径。

在此之前，这次调用由客户端在 `agent_end` 时发起（`ChatWindow` → `POST /api/sessions/{id}/suggest`），结果只存在 React state 里。由此得到的行为边界是：只有会话在浏览器里开着标签页时才有建议——关掉标签、刷新页面、换设备就什么都没有；服务端重启或进程被回收也不留痕。而服务端本来就在 `agent_end` 上有自己的钩子（会话通知、上下文占用刷新），也就是说"会话的正常结束"这个事实在服务端是已知的，只有建议问题不知道。

我们把这个关切挪到服务端，并让它成为一条可复用的派生数据。

**1. 触发点是 `AgentSessionWrapper` 的 `agent_end`，不是扫描器。**

`agent_end` 且 `willRetry === false` 时，`rpc-manager` 起一次后台任务（`lib/server/suggested-prompt-background.ts`）。不选"定期扫 JSONL 找已结束但没建议的会话"，是因为扫描器需要自己维护游标、重启补偿与"哪些会话值得算"的规则，而钩子直接拿到会话身份和终态。代价是：升级前就结束的历史会话不会被回填，只在被打开时补算——这个取舍写在这里，免得以后被当成 bug。

**2. 结果按 `(sessionId, leafId)` 落在 `~/.pi-work/suggested-prompts/<sessionId>.json`。**

`leafId` 就是活动路径的末端 entry id，因此它同时是"这个终态算没算过"的去重键：同一 `leafId` 的上下文永远相同，不需要额外的 `lastEntryId`。选会话 sidecar 而不是 SQLite，是因为这份数据是纯派生的、随会话删除而失效；`session-names/` 已经给出了范式（原子 tmp+rename、SAFE_ID 校验、删除会话时清理），不需要为一张缓存表引入迁移。每个会话最多保留 5 条，按 `generatedAt` 淘汰。

**3. 失败也是结果，但分两种时效。**

成功与确定性失败（`empty-suggestion`、`suggestion-too-long`、`turn-not-complete`）永久落盘：这些终态重放多少次都不会变好。临时失败（`generation-failed`，超时/上游报错）带 10 分钟 TTL，过期后允许重算。没有这层缓存，SSE 重连或压缩重放同一个 `agent_end` 会重复付费。

**4. 读取走 `GET`，推送走已有的 SSE 事件通道。**

`GET /api/sessions/{id}/suggest?leafId=` 只读 sidecar，不碰模型；后台算完通过 `suggested_prompt` 事件推进同一会话的 SSE 流。客户端在挂载、切分支、turn 结束后 `GET` 一次，命中就用推送覆盖。`POST` 降级为"缓存未命中时的补算"，覆盖历史会话与首次打开的情况。

**5. 生成队列是进程内的，键是 sessionId。**

`directPrompt` 没有并发上限，后台化后同一时刻可能有多个 `agent_end`。`lib/server/suggested-prompt-queue.ts` 给全局并发 2 个上限，并对同一个 key 复用同一个 promise，POST 与后台任务因此共享一次调用而不是各付一次钱。key 用 sessionId 而不是 `(sessionId, leafId)`：按会话单飞比按 leaf 单飞更严格，目的是"同一个终态不重复付费"，而 leaf 级去重已经由 sidecar 承担。队列只存在于进程内，重启即丢——丢掉的只是"正在算"，不是"算过"。

## Considered options

- **保留客户端触发，只把结果落盘。** 改动最小，但"关标签就没有建议"原样保留，等于没有解决提出这个决定的那条问题。
- **独立后台循环扫描会话目录。** 能追平历史会话，但要自己维护"哪些会话算过、哪些该补、补多少"，且在没有任何同意的情况下对本地全部历史做一轮模型调用。
- **额外加一个"仅前台可见的会话才生成"的限制。** 省 token，但只是把"只有开着的标签有建议"这个缺陷搬到服务端，并且多一份在线会话集合的状态要维护。`suggested_prompt.enabled` 已经是用户对这项开销的授权。
- **把建议写回会话 JSONL。** 最省事，但派生数据进主数据，用户会话文件被 UI 缓存污染，导出与迁移都得跟着处理。

## Consequences

- `suggested_prompt.enabled` 的含义变宽了：它不再只对"开着的标签"生效，而是对所有正常结束的 turn。这是这次决定的成本，写在这里而不是藏在设置文案里。
- 上下文仍是整条活动路径（本次有意不改），所以长会话每次的计算成本随历史线性增长；如果以后要加窗口，改 `extractSuggestedPromptContext` 即可，不影响存储与触发。
- 自动命名是同一类"客户端触发、关标签就丢"的问题，但它是每会话一次、失败还会 toast，语义边界不同，本次不动。
- 客户端的状态机因此大幅收缩：不再需要 `turn` 计数与 `inFlight` 去重，只保留"当前 leaf 的那一条"，去重交给 `(sessionId, leafId)` 与服务端队列。
