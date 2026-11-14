# 压缩设置只在 Pi Work 露出 pi 的三个可调项，阈值语义仍归 pi

自动压缩的判定、估算与执行都在 `@earendil-works/pi-coding-agent` 里：`shouldCompact` 拿「上下文估算值」和 `contextWindow - reserveTokens` 比大小（默认 `reserveTokens` 16384、`keepRecentTokens` 20000），`compaction_start` 的 `reason` 只有 `threshold` / `overflow` / `manual` 三种。Pi Work 之前只渲染这些事件，用户在 Web UI 里没有任何入口改阈值，只能手改 `~/.pi/agent/settings.json`。

**我们决定**：

- **设置页新增「Context compaction」，读写的仍是 pi 的 `settings.json` 的 `compaction` 块**，走 `lib/server/agent-settings.ts` 同一套读写与原子备份，不引入 Pi Work 自己的配置副本。只暴露 `enabled`、`reserveTokens`、`keepRecentTokens` 三项。
- **阈值用 `reserveTokens` 表达，不提供「百分比」或「上下文窗口占比」这种换算层。** 换算层需要知道当前模型的 `contextWindow`，而设置页不属于任何会话；多一层换算只会让「改完之后到底在哪触发」更难回答。
- **`compaction.modelOverrides` 不在这次露出。** 它按 `provider/modelId` 键控，需要模型列表与逐项表单；一旦露出就得在设置页里维护一份模型清单，与 `ModelsConfig` 重复。写入时保留该字段，重置时也只删我们露出的三项，`modelOverrides` 原样留在文件里。
- **重置删掉的是「我们露出的字段」，不是整个 `compaction` 块。** 三者都删空时整块一起删，`settings.json` 回到 pi 的默认解析路径；块里还剩别的键就只留那些键。
- **写入后不主动 reload 会话。** pi 的 `SettingsManager` 只在会话 `reload()` 时重读文件，所以面板上写明「只对新会话生效」——和「Agent retry」保持一致，不去猜测哪些运行中的会话可以安全重载。

## Considered options

- **只写文档、不做入口。** 手改 JSON 对 `reserveTokens` 这种纯数字配置是可接受的，但用户看不到默认值、也没有范围校验；写错一个负数会让 pi 抛 `Invalid compaction.reserveTokens setting`。
- **在 Pi Work 自己实现阈值判定并调用 `/compact`。** 那等于把 pi 的估算与切点逻辑复制一份，UI 的判定与真正压缩时的判定会漂移；而且 Pi Work 看不到 `isCompacting` 之外的内部状态。
- **把 `modelOverrides` 一并做成表单。** 收益是 1M 窗口模型可以单独设阈值，代价是设置页要自己维护模型清单与校验。等真正有人需要按模型区分时再单独做。

## Consequences

- 阈值语义（默认 16384 预留、`keepRecentTokens` 20000）的单一来源仍是 pi 的 `settings-defaults.js`；Pi Work 的 `DEFAULT_AGENT_COMPACTION` 只用于表单占位与重置动画，不参与判定。pi 改默认值时这里要跟着改。
- 新增或删除这里露出的字段，等于改变 `settings.json` 里「重置」的边界：`resetAgentCompaction` 保留其余键，所以 `modelOverrides` 与未来 pi 新增的压缩键不会被人从 UI 上误删。
- 面板上「只对新会话生效」是当前行为的描述；如果哪天 Pi Work 主动 reload 会话，这句话要跟着改。
