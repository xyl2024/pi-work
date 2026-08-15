# LLM API 调用审计(llm-audit)

> 回答一个具体问题:**"Pi Work 每次调用 LLM API 时发生了什么?"**
>
> 审计功能在进程级拦截真实 HTTP 调用,记录完整请求体、状态码、响应头,
> 以及失败时的完整响应体,并按会话归因,供面板查询排查(比如"模型调用
> 失败停下却没留下任何信息"的场景)。

---

## 架构与数据流

```
浏览器发消息 → rpc-manager.send()
              └─ AsyncLocalStorage.run({ sessionId, source, cwd, sessionName })
                   └─ Agent → streamFn → 包装 ModelRuntime(写 model 元数据 + 调用序号)
                        └─ pi-ai → SDK client
                             └─ globalThis.fetch ←── 审计 patch(唯一记录点)
                                   ├─ 命中 provider host 白名单? 否 → 原样转发
                                   ├─ 2xx    → 记录 URL/请求体/状态码/响应头/耗时
                                   └─ 非 2xx → clone 读完整错误响应体落库,原响应还给 SDK
```

- **存储**:`~/.pi-work/llm-audit.db`(SQLite,WAL)。表 `provider_calls`,每次 HTTP 调用一行。
- **归因**:`session_id` / `source`(user / scheduled / direct)/ `cwd` / `session_name` / `provider` / `model_id` 由 ALS 上下文在命令时刻快照。
- **关联入口**:`rpc-manager.send()`(主对话、scheduler)、`/api/sessions/[id]/auto-name`(标题生成)、`/api/translate`(翻译)。三者都已包审计上下文。
- **前端**:右栏"LLM API audit"面板。有当前会话时自动按会话过滤;新建会话页显示全局。

---

## 风险点

### 高

| 风险 | 说明 | 缓解 / 现状 |
| --- | --- | --- |
| **全局 fetch patch 影响主链路** | patch 了 `globalThis.fetch`,任何走它的代码都在拦截范围内(虽有 host 白名单)。若 patch 有 bug,可能拖慢/破坏所有依赖 fetch 的功能(RSS、http-proxy、git 等)。 | 白名单只匹配 provider baseUrl 的 host;patch 原样透传 init(含 AbortSignal);错误一律 rethrow 原错误;每次 insert 失败只记 warn 不影响请求。仍需回归测试。 |
| **非 2xx 时同步读 body** | 失败响应先 `clone()` 读完整个 body(上限 512KB)才把 response 还给 SDK,读 body 的时间计入该请求耗时,且阻塞该次 fetch 的返回。 | 上限 512KB 截断;读失败只记 null。慢速大错误页会拖慢但不会挂死。 |
| **同步 SQLite insert 在请求路径上** | `better-sqlite3` 是同步 API,每次调用在 fetch 返回时同步写库,高并发下可能成为瓶颈。 | WAL 模式 + `synchronous=NORMAL`;insert 包 try/catch 失败不影响请求。尚未做并发压测。 |
| **对话全文明文落盘** | `request_body` 存完整请求体(系统提示词、全部消息、工具结果),可能含粘贴的 API key、密码、内部代码。 | 请求头敏感值(authorization / x-api-key)打码;**请求体本身不打码**。DB 无加密,权限为用户目录默认。这是本功能最大的隐私面。 |

### 中

| 风险 | 说明 | 缓解 / 现状 |
| --- | --- | --- |
| **localhost 本地模型误拦** | 若 provider baseUrl 是 `http://localhost:11434`(ollama 等),host=`localhost` 会进白名单,Next.js 服务器自身对 localhost 的 fetch 也可能被误记录(只多记录,不改行为)。 | 未特殊处理;观察面板中 host 异常的记录即可发现。 |
| **并发会话归因串扰** | 归因依赖 ALS 上下文,多会话并发时依赖 AsyncLocalStorage 隔离正确。 | 每个 `send()` 创建独立 store,理论隔离;未做并发压力验证。 |
| **abort / 流中断** | 用户停止生成时,底层 fetch 被 abort,审计记录网络层错误(或 2xx 但流被取消)。 | catch 分支记录 error 并 rethrow;不影响 abort 语义。 |
| **HMR 状态错位**(dev 模式) | Next dev 热更新会重载模块,旧 fetch patch 闭包与新版代码可能错位,导致不记录或归因丢失。 | hosts 白名单与 AsyncLocalStorage 挂在 `globalThis` 共享;模块重载时重装 patch;`send()` 兜底重装。已修但属于 dev-only 关注点。 |

### 低

| 风险 | 说明 | 缓解 / 现状 |
| --- | --- | --- |
| **attempt(调用 N)语义** | 显示的是"该回合内第几次调 LLM",不是重试次数;provider 重试会共享同一序号(多行 ts 不同)。 | 面板文案已改为"调用 N";重试轨迹靠 ts 辨别。 |
| **数据无限增长** | `provider_calls` 只增不删,`pruneProviderCalls()` 存在但**未接入任何自动清理**。 | 长期运行会持续膨胀;保留策略待定。 |
| **面板大 body 渲染** | 展开超大请求体详情时前端有 maxHeight 滚动保护;列表分页 50/页。 | 已内置基本保护。 |
| **2xx 响应体不记录** | 成功响应是 SSE 流,刻意不读,`duration` 只到响应头到达(不含流式传输)。 | 有意的取舍;完整生成时长看 token 审计面板。 |

---

## 已知限制

- 成功(2xx)响应的 body 不落库(SSE 流),只记状态码与响应头。
- 非 session 触发的调用(若有)归因 `source=unknown`,provider 由 URL 推断(host 名)。
- 历史数据无法追溯归因:标题生成调用在修复前记录的会一直显示为 unknown。
- `duration_ms` 是"请求发出 → 响应头到达",不含 2xx 流式 body 消费时间。

---

## 数据位置

| 文件 | 内容 | 备份优先级 |
| --- | --- | --- |
| `~/.pi-work/llm-audit.db` | 每次 LLM 调用的完整请求/响应记录(含隐私内容) | 视隐私敏感度决定是否纳入备份;包含敏感对话明文,备份即扩散 |
