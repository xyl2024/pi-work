# 08: 完整生命周期验收与入口一致性

Category: enhancement
Status: done

**What to build:** 用户与父 agent 能完整完成创建、等待到期、查询、再次等待、继续、总停止和重启后跟进；工具、通用输入及 UI 入口对同一任务给出一致行为。

**Blocked by:** 03: 重新等待已有任务; 06: 用户手动跟进也进入任务管理; 07: 重启后对账与安全继续.

**Status:** done

- [x] 通过主要工具 seam 完成 spawn 等待到期后后台继续、list/get 找回、wait 拿结果、continue 新回合、精确 cancel 和父总停止的连续场景。
- [x] 跨用户手动输入与 agent 委派验证同一会话无重叠回合，停止期间不漏并发新建任务，后续任务不被旧 cancel 影响。
- [x] 通过重启场景验证中断记录、显式继续、历史结果及配置快照恢复，不自动重试。
- [x] 检查所有工具、输入、停止和详情入口的直属归属校验、禁止递归、子代理身份保持及重命名后工具选择；新旧卡片均可展示，旧名不能调用。
- [x] 确认 UI 对排队、执行、停止中、终态、中断与截断表达一致，父回合结束后可正常发送并独立停止后台任务，所有新增文案国际化。
- [x] 各前置 ticket 自带行为测试，本票只补跨流程缺口，不重复内部实现断言，不把测试全部延后到此票。
- [x] 执行匹配改动的类型/lint 与隔离行为测试；不擅自启动 UI 测试、不运行覆盖共享构建目录的日常生产构建，报告已验证及未执行的人工验收。

## 实现备注

- 新增 `tests/unit/subagent-lifecycle-acceptance.test.ts`，每个用例是一条连续流程，通过产品实际使用的入口（`subagent` 工具、手动输入 module、`/api/sessions/[id]/subagents/stop-all`）驱动真实任务管理 + 临时 SQLite + 脚本化回合 adapter；只在证明“回合是否真的停了”时读管理器的 live 状态。覆盖：等不到结果的 spawn 之后仍可 list/get 找回、再次 wait 拿到结果、continue 复用会话、精确 cancel 旧任务、父总停止经 REST 入口级联并等回合确认才变 `cancelled`；手动输入与 agent 委派双向共用 busy、停止窗口拒绝新建任务、旧 cancel 不影响后续任务；长结果被有界截断并由 `get` 续读。旧 `spawn_subagent` 动作不创建任务那条用例需要直接调 `execute`（真实 SDK 在 schema 层就拒绝），其余都走产品入口。重启对账/显式继续/配置快照/不重放由 07 的 `subagent-restart.test.ts` 覆盖，本票不重复；直属归属、禁止递归、身份保持与工具选择迁移分别由 `subagent-queries`、`subagent-restart`、`subagent-manual-input`、`subagent-tool-migration` 的前置测试钉住。
- 修复验收中发现的两处表达不一致：
  - `spawn`/`wait`/`continue` 之前把 `task.result` 原样返回，长报告既没有截断标记也没有续读方式（与工具描述和用户故事 11 不符）。现在结果与 `get` 共用 `sliceSubagentText` 默认 4000 字符窗口，文本带 `[truncated]` 与 `action="get" … result_offset=N` 续读指令；`details.result` 只带该窗口，并新增 `resultTruncated` / `resultNextOffset`，`cancel` 的 details 也守同一契约，调用方读 details 时不会把前缀当成完整结果。截断提示共用同一句 `resultContinuation`，不在 `get` 与 `wait` 之间写两套。
  - 新建 `lib/shared/subagent-status.ts` 统一状态文案 key 与颜色，`SubagentSessionsButton` 与 `SubagentLivePanel` 共用；`creating` 不再在卡片里显示成 “Subagent running”，排队/停止中/各终态的颜色也不再两套。文案仍走 `t()`，没有新增硬编码文本。为了共用一套颜色，列表里的 `running` 从主题强调色改为卡片原本使用的绿色，属于有意的视觉统一。
- `parseSubagentParams` 遇到未知 `action` 时先返回参数错误，避免旧名（或任何非法动作）在 `ACTION_KEYS` 查表处崩溃。
- 未执行人工 UI smoke（仓库约定不擅自启动服务）：卡片状态标签、父回合结束后「独立停止全部」入口与截断文案通过类型检查、ESLint、静态审查和外部接口测试确认；相关 UI 入口为 `components/chat/SubagentSessionsButton.tsx`（列表 + 独立 stop-all）与 `components/chat/message-view/SubagentLivePanel.tsx`（卡片状态）。`pnpm run build` 未运行。
