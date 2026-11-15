# ADR-0054: Follow-up 改为"结束后自动发送"的输入框 chip

日期：2026-11-15

## 背景

恢复的 Follow-up 最初直接调 RPC `follow_up`（服务端队列），点击即乐观渲染一条 user 消息。用户要求改为：点击后不渲染 user 消息，输入框上方显示一条 chip（同斜杠命令 chip 样式，宽度上限 + 省略号），等 assistant 消息真正结束（agentRunning 变 false）后才作为普通 prompt 发出。

## 决策

- 队列状态留在 ChatInput 本地（`pendingFollowUps`），发送走现有 `onSend`（即 `handleSend` 的普通 prompt 路径），不再调 RPC `follow_up`；hook 的 `handleFollowUp` 与 `onFollowUp` prop 移除。服务端 `steer`/`follow_up` RPC case 保留不动。
- 每轮结束只排空一条（发送会让 agentRunning 重新变 true，自然串行）。
- chip 可点 × 移除；卸载即取消排队，服务端无未送达的残留。
- 换会话（sessionId prop 变化）清空 chip，避免把排队的消息发进错误的会话。
- 用户按 Stop 后 agentRunning 变 false，排队的 chip 会照常发出——Stop 是"真正结束"的一种；不想发就先删 chip。

## 取舍

不依赖 RPC 队列意味着页面刷新会丢失未发送的 follow-up（server 队列本来也会丢失前端显示）。换取的是：发送时机、显示形态完全由前端可控，且复用普通 prompt 的乐观渲染与错误处理，不需要为 follow-up 在事件协议里区分用户消息来源。
