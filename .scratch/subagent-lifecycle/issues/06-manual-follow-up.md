# 06: 用户手动跟进也进入任务管理

Category: enhancement
Status: done

**What to build:** 用户打开子代理会话查看、停止或继续工作时，操作和父 agent 委派进入同一任务管理，避免未被记录、无法总停止的手动回合。

**Blocked by:** 05: 在已有子会话中继续委派.

**Status:** done

- [x] 打开子会话可查看历史和当前任务，手动输入生成独立任务记录并可被父 agent 查询，能够区分手动提交的输入。
- [x] 已知子会话的通用用户输入入口必须经过任务管理，不能绕过 busy、并发调度、请求去重或父会话总停止。
- [x] 手动继续不把子代理转换为普通会话，不自动提升权限或替换创建时配置；停止功能作用于正确任务。
- [x] 子代理不继承父完全访问模式，权限确认遵循既有快速拒绝规则；无人可回答的提问立即明确失败，不无限挂起。
- [x] 已有界面显式调整子会话权限模式的规则仍适用，不提供 agent 自动提权入口。
- [x] 用户输入与父 agent continue 同时提交时最多启动一个未结束任务；手动任务也可被父总停止取消。
- [x] 入口契约及交互闸门测试覆盖身份保持、手动输入被跟踪、并发 busy 和提问快速失败；UI 文案国际化，人工 UI 验收遵守项目启动限制。

## 实现备注

- 新增 `lib/server/subagent-manual-input.ts` 作为用户手动输入的唯一条目模块：`submitSubagentManualPrompt` 只调用 `SubagentTaskManager.continue`（不复刻调度/回合），因此 busy、全局 4 并发 FIFO、请求去重、父总停止窗口、创建时配置快照全部沿用同一规则；`stopSubagentTaskForChildSession` 把子会话的停止落到该会话当前未结束的任务，空闲时返回 `null` 让命令走会话自身路径（例如压缩）。
- 归属由任务行判定（`getSubagentTaskByChildSessionId`），不信任调用方自报的父会话；任务新增 `origin` 列（`tool` / `manual`，`ALTER TABLE ... DEFAULT 'tool'` 幂等迁移，旧行保持 `tool`）。`list`/`get` 的会话行与详情都带 origin，父 agent 文案里显示 `origin: manual …`，UI 弹层给手动任务加「手动」标记。
- `POST /api/agent/[id]` 是通用用户输入入口：`prompt`/`abort` 打到已知子会话时交给任务模块（busy/stopping → 409、无法投递 → 400），其它命令（`get_state`、工具选择、`set_permission_mode` 等）仍走原路径，所以「用户显式调整子会话权限模式」的既有界面规则不变，也没有 agent 可达的提权入口；手动输入不接受图片（任务只记录文本 prompt），也不会被静默丢掉。客户端每次发送带 `request_id`，同一请求体重试不会启动第二个任务；被 409 拒绝时乐观插入的用户消息会回滚，不留下没提交成功的输入。
- 身份保持：会话冷启动统一走 `openSubagentChildSession`（事件流 / `GET` / `POST` 三条路径共用），按创建时快照重开（模型、思考强度、工具、系统提示词、`source: "subagent"`），不会变成普通 user 会话、不会重新注册 subagent 工具（递归仍禁止），旧快照缺失的行只恢复身份（受限配置恢复归 issue 07）。
- 交互闸门：仍按 ADR-0001 由 `InteractionGates` 对 `source === "subagent"` 快速拒绝需确认的命令；`ask_user_questions` 现在对 scheduled 与 subagent 都用一张 `UNATTENDED_REFUSAL` 表立即返回明确错误（原来只有 scheduled），不再等一个没人回答的提问。子代理照旧从自己的 sidecar 读取权限模式（默认 confirm，从不继承父会话完整访问）。
- 测试 `tests/unit/subagent-manual-input.test.ts`：真实任务管理 + 脚本化回合 adapter + 临时数据根，覆盖手动任务被记录/可区分、快照配置与 subagent 身份保持、busy 拒绝、与父 `continue` 竞争只启动一个任务、请求去重与跨会话复用拒绝、父总停止级联与停止窗口拒绝、按会话精确停止、图片/空文本拒绝、活 wrapper 复用与非子会话返回 null；另外用真实 `Request` 驱动 `/api/agent/[id]` 的 prompt/abort 契约（含 409、abort 无任务时回落），以及 `ask_user_questions` 在 subagent 会话中的快速失败。
- 未执行人工 UI smoke（仓库约定不擅自启动服务）：弹层「手动」标记、停止全部入口与后台任务不占发送按钮仅通过类型检查与静态审查确认。
