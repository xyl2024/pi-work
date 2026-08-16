# pi SDK 升级建议报告（0.82.0 → 0.84.2）

> 生成日期：2026-08-14 后 · 分析对象：`@earendil-works/pi-coding-agent` 0.82.0 → 0.84.2（含 `@earendil-works/pi-ai` 0.82.0 → 0.84.2）

## 1. 结论先行

**建议直接升级到 0.84.2，风险低，收益明确。**

- 0.82.0 → 0.84.2 共 5 个中间版本（0.82.1 / 0.83.0 / 0.84.0 / 0.84.1 / 0.84.2），每版约一周发布节奏。
- 0.84.0 含多项 Breaking Changes，但**逐条核对后均不触及 pi work 当前使用的 API 面**（详见 §4）。
- 收益：新模型自动可用、多项稳定性与安全修复（含 5 个 CVE 相关的传递依赖升级）。
- 不需要分步升级——中间版本没有必须经过的迁移步骤。

---

## 2. 版本时间线与主要变更

| 版本 | 日期 | 主要内容 |
|---|---|---|
| **0.82.0**（当前） | 07-24 | 受约束工具采样、OpenRouter/Kimi Code 登录、bash 会话环境变量 |
| 0.82.1 | 07-25 | Claude Opus 5（Anthropic/Bedrock）、`ANTHROPIC_AUTH_TOKEN`、模型目录 304 缓存 |
| 0.83.0 | 07-29 | **TypeBox 1.1.38 → 1.3.7（唯一波及 pi work 代码的 breaking）**、`pi auth print-api-key`、headless OpenRouter 登录、GitHub Copilot Opus 5 |
| 0.84.0 | 08-06 | **多项 Breaking Changes**（见 §3）、全屏 TUI 模式、Mermaid/LaTeX TUI 渲染、Baseten provider、`AGENTS.override.md`、实验性远程 session 客户端 |
| 0.84.1 | 08-07 | Qwen Token Plan Individual、`pi auth check`、`Agent.reset()` 活动期拒绝修复 |
| 0.84.2 | 08-14 | `defaultTools` 设置、RPC `message_update` 累积 usage 修复、`nanoid`/`undici`/`brace-expansion` 安全修复、Mistral 传输层替换 |

---

## 3. 0.84.0 Breaking Changes 逐条对照 pi work

| # | Breaking Change | pi work 是否受影响 | 依据 |
|---|---|---|---|
| 1 | pi-ai `ModelsStreamTransforms` → `ModelsRequestTransforms` 重命名 | ❌ 不受影响 | pi work 未引用该接口 |
| 2 | JSON/RPC `message_update` 只发 `assistantMessageEvent` 增量，移除累积 `message` / `partial` 字段 | ❌ **不受影响** | 该变更仅作用于 `toJsonEvent()` 转换（`--json` 与 RPC stdout 协议）。pi work SSE 走 `AgentSession.subscribe()` 内存事件，`MessageUpdateEvent` 在 0.84.2 中仍携带完整 `message: AgentMessage`（`dist/core/extensions/types.d.ts:569-571`） |
| 3 | `ModelRegistry.getApiKeyAndHeaders()` 返回 `ProviderHeaders`（`string \| null`） | ❌ 不受影响 | pi work 未调用 |
| 4 | `ModelRegistry.refresh()` / `ModelRuntime.setRuntimeApiKey()` 签名变化 | ❌ 不受影响 | pi work 未调用 |
| 5 | 扩展 OAuth `refreshToken(credentials, signal)` 必须接受 AbortSignal | ❌ 不受影响 | pi work 不 `bindExtensions`、不注册 OAuth provider |
| 6 | Provider `refreshModels` 上下文重构（`context.stored` / `context.publish()`） | ❌ 不受影响 | pi work 不注册 provider |
| 7 | **pi-agent-core 内部升级到 v4 lane-based Session/`JsonlSessionRepo`，移除 legacy JSONL/in-memory repository API** | ⚠️ 间接影响，风险低 | 对外 `SessionManager`（`open`/`create`/`inMemory`/`list`/`listAll`）与 `CURRENT_SESSION_VERSION = 3` **完全不变**，`.jsonl` 文件格式不变。`session-reader.ts` 的解析路径（`SessionManager.listAll` + 自有解析 + SDK `buildSessionContext`）无需改动。需回归验证（见 §6） |
| 8 | `FileSystem.renameFile()` 成为必需操作 | ❌ 不受影响 | pi work 未提供自定义 harness 文件系统 |
| 9 | 实验性 `RemoteSession.sessions` 不再暴露运行时状态 | ❌ 不受影响 | pi work 未用实验性 remote-session API |

**另确认**：包根导出移除了 `InteractiveMode`（`modes/index.d.ts` 仍导出，pi work 未用）；新增导出（`CredentialSynchronizationError`、`TuiMode`、`JsonAgentSessionEvent` 等）均为增量。

---

## 4. pi work 使用面逐项 API 兼容性验证

对 `lib/`、`app/api/` 中所有 SDK 导入符号逐一与 0.84.2 类型定义比对，**全部兼容**：

| pi work 使用点 | SDK 符号 | 0.84.2 状态 |
|---|---|---|
| `lib/rpc-manager.ts` | `createAgentSession` / `DefaultResourceLoader` / `ModelRuntime` / `isToolCallEventType` | 签名不变 |
| `lib/rpc-manager.ts` | `AgentSession`：`sessionId` `sessionFile` `subscribe` `prompt` `abort` `setModel` `navigateTree` `getContextUsage` `setThinkingLevel` `steer` `followUp` `getAllTools` `getActiveToolNames` `setActiveToolsByName` `agent.state` `modelRuntime` `sessionManager` `model` `isStreaming` | 全部保留，签名不变 |
| `lib/rpc-manager.ts:884` | `agent.state.systemPrompt = ""`（无工具时清空系统提示词） | `AgentState.systemPrompt` 仍存在且可写（pi-agent-core `types.d.ts:291`） |
| `lib/rpc-manager.ts` | `AgentEvent` / `AgentSessionEvent` 事件形状（`message_start` `message_update` `message_end` `tool_execution_*` `permission_request` `compaction_*` `thinking_level_changed` `prompt_failed` `agent_start/end` `auto_retry_*`） | 事件类型 diff：**只增不改** |
| `lib/rpc-manager.ts` | `session_tree_update`（pi work 自合成） | 不依赖 SDK |
| `lib/rpc-manager.ts` / custom tools | `defineTool` | 签名不变（`types.d.ts:386`） |
| `lib/todo-tools.ts` / `lib/agent-todo-tool.ts` | `StringEnum`（pi-ai） | 0.84.2 仍导出 |
| `app/api/models/route.ts` | `getSupportedThinkingLevels`（pi-ai） | 仍导出（`models.d.ts:193`） |
| `app/api/auth/*` | `Provider` 类型（pi-ai）、`ModelRuntime.getProviders/getModels/getProviderAuthStatus/listCredentials` | `Provider` 接口仍在；`listCredentials()` 增加可选参数（向后兼容） |
| `lib/session-reader.ts` | `SessionManager` / `buildSessionContext` / `getAgentDir`；`SessionEntry` / `SessionInfo` 类型 | 不变；`CURRENT_SESSION_VERSION=3` 不变 |
| `lib/llm-direct.ts`（翻译面板） | `createAgentSession` + `SessionManager.inMemory()` + `noTools:"all"` | 不变 |
| `lib/show-file-tool.ts` / `lib/ask-user-questions-tool.ts` | `defineTool` / 工具 schema | 不变 |
| `lib/wechat/inbound.ts` / `lib/session-export/pi-html.ts` | `SessionManager` | 不变 |
| pi-ai 根导出（0.82.0 vs 0.84.2） | `export *` 清单 | **完全一致**（diff 为空） |

唯一需要编译验证的点：**TypeBox 1.1.38 → 1.3.7**（0.83.0）。移除的 API 为 `Type.Base` / `Type.Awaited` / `Type.Promise` / `Type.AsyncIterator` / `Type.Iterator` / `Type.Options` / `Value.Mutate`。pi work 的 customTools（agent_todo 等）仅使用 `Type.Object/String/Array/Record/Unknown/Number/Boolean/Optional`，均属保留 API，但建议升级后跑一次 `tsc --noEmit` 兜底。

---

## 5. 升级收益

### 模型与能力（pi work 零改动即可受益）
- Claude Opus 5（Anthropic / Bedrock / GitHub Copilot）、Qwen Token Plan（订阅制）、Baseten provider、GPT-5.6 系列（Codex）等新模型自动进入 `/api/models` 目录。
- 模型目录 `If-None-Match` 304 缓存 → 启动与刷新更快。

### 稳定性修复（直接影响 pi work 运行体验）
- DNS 失败（`getaddrinfo`/`ENOTFOUND`）自动重试、OpenAI/Anthropic 重试等待尊重 abort。
- 手动 `/compact` 与阈值自动压缩的竞态修复（0.84.0）。
- 活动响应期间的会话替换/树导航改为中止并持久化当前回合（0.83.0）——pi work 的分支导航更安全。
- JSONL 会话 fork/断尾修复改为**原子发布**，避免中断写入产生损坏会话（0.84.0）。
- OAuth 令牌刷新提前到剩余 5 分钟（0.83.0），停滞请求释放凭证锁（0.84.0）。
- `Agent.reset()` 在活动运行期间不再清空会话（0.84.1）——pi work 未调用，但防未来踩坑。

### 安全
- `protobufjs` 7.6.5（GHSA-j3f2-48v5-ccww）、`brace-expansion` 5.0.8/5.0.9（GHSA-mh99-v99m-4gvg 等）、`undici` 8.9.0（5 个 GHSA）、`nanoid`（DoS）——均随 0.84.x 传递依赖升级。

### 未来可用的新特性
- `defaultTools` 设置（0.84.2）：pi work 新建会话的工具默认值未来可与之联动（当前 pi work 总是显式传 `toolNames`，不受该设置影响）。
- `pi auth print-api-key` / `print-bearer-token`（0.83.0）：外部客户端凭证导出。
- 实验性 `@earendil-works/pi-coding-agent/client` 远程会话协议（0.84.0）：远期可探索替代轮询。
- `AI_AGENT=pi` 环境变量注入 bash 工具（0.84.0）。

---

## 6. 升级步骤与验证清单

### 步骤

```bash
# 1. 升级两个直接依赖（pi-agent-core / pi-tui 随 pi-coding-agent 传递解析到 0.84.2）
npm install @earendil-works/pi-coding-agent@0.84.2 @earendil-works/pi-ai@0.84.2 --include=dev
#    ^ 若 tarball 下载卡住，加 --registry=https://registry.npmmirror.com
#    ^ 若 npm 报"up to date"但装不上，rm -f node_modules/.package-lock.json 后重试

# 2. 类型检查（必须）
node_modules/.bin/tsc --noEmit

# 3. 针对性 lint
node_modules/.bin/eslint lib/rpc-manager.ts lib/session-reader.ts lib/todo-tools.ts lib/agent-todo-tool.ts lib/show-file-tool.ts lib/llm-direct.ts hooks/useAgentSession.ts
```

### 功能回归清单（按风险优先级）

1. **会话读写**（风险最高，因 0.84.0 内部换了 v4 存储实现）：新建会话 → 发消息 → 侧栏列表 → 重开既有会话（`session-reader` 解析新格式 .jsonl 正常）。
2. **SSE 流式**：流式输出、`message_update` 增量渲染、工具流式输出（`tool_execution_update`）、中断/重试。
3. **工具调用**：`agent_todo`（create/update/status）、`show_media`、`user_todos_list`、`ask_user_questions`（若启用）——验证 TypeBox 1.3.7 下 schema 校验正常。
4. **工具选择**：Off / Full / Read only / Custom 四种模式（含 `agent.state.systemPrompt = ""` 清空路径）。
5. **分支导航**：`Edit from here` → 切换叶子 → `/api/sessions/[id]/context?leafId=`。
6. **压缩**：手动 compact（`compaction_start/end` 事件）与自动压缩阈值。
7. **权限对话框**：`permission_request` → allow once / allow similar / deny。
8. **模型与认证**：`/api/models`、模型切换、thinking level、OAuth 登录流程。
9. **翻译面板**：`/api/translate`（`SessionManager.inMemory()` 路径不落盘）。
10. **既有会话兼容**：升级后打开旧 0.82.0 生成的会话文件，确认无迁移报错（pi 0.84.x 自带迁移逻辑，且 `CURRENT_SESSION_VERSION=3` 未变，预期平滑）。

### 风险备注

- **双版本风险**：pi work 不直接依赖 `pi-agent-core`，npm 只会安装 pi-coding-agent 传递的 0.84.2 单副本，无 duplicate 问题。
- **生产环境**：若在 `NODE_ENV=production` 的 shell 中安装，务必 `--include=dev`（否则 devDependencies 被跳过）。
- **回滚**：`package-lock.json` 已记录 0.82.0，`git checkout` 还原即可。
