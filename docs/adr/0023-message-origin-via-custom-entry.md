# 消息来源用 custom entry 旁路记录，而非 UserMessage 元数据

pi SDK 的 `UserMessage` 只有 `role`/`content`/`timestamp`，没有任何可携带自定义元数据的字段；而「这条用户消息从哪来」（网页端、频道、定时任务、子代理会话）是每条消息的属性，必须在 JSONL 里持久化才能在历史回放时正确渲染。我们决定：非网页来源的用户消息在写入后，紧跟追加一条 `{type:"custom", customType:"pi_work_message_origin"}` entry 记录来源（含实体 id 与名称/标题快照），读取时归属树序上最近的前一条 user message；JSONL 中没有标记 ≡ 网页端发送。

## Considered Options

- **`custom_message` entry**：pi 原生支持带 `details`，但它会进 LLM 上下文，等于往对话里塞模型可见的消息——不可接受。
- **包装 prompt 文本**（给非网页消息加前缀标记）：污染模型输入——不可接受。
- **会话级 sidecar 映射**（如 `~/.pi-work/session-origins/`）：只能记会话级来源，而频道绑定的会话随时可能被用户在网页端手动输入，per-message 才准确。

## Consequences

- 写入点收敛在 `rpc-manager` 的 `dispatch("prompt")`：RPC 命令增加可选 `origin` 字段，由频道 inbound、定时任务 runner、subagent 手动输入路径填好；网页端不传。只有非 web 来源才写 entry，避免 JSONL 膨胀。
- 会话内 turn 串行，「最近前一条」归属不会竞争；极小概率 prompt 失败导致 origin 错挂到上一条消息，只影响显示层，不影响对话数据。entry 内记录的毫秒时间戳仅作诊断；文本前 80 字符除诊断外，还在实时路径被 pending 归属匹配兼用作前缀比对（`rpc-manager` 的 `consumePromptOrigin` 用 `text.startsWith(p.messagePrefix)` 找回排队中的 origin）——历史归属始终只靠消息树位置，这个前缀比对不参与读取回环的判定。
- origin 随 custom entry 走消息树：分支时自然脱落、压缩时随旧分支消失，与消息生命周期一致。
- `UserMessage` 上为传输/展示加的可选 `origin?` 字段只存在于 API/SSE 边界，永远不会写回 JSONL 消息体。若上游 pi SDK 将来给 `UserMessage` 增加元数据字段，本决策可重估。
