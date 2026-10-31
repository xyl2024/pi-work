# 子代理专用网络工具：只给子代理源注册，后端交给 DeepSeek

ADR-0013 删掉了 `web_search` / `fetch_content` 与整条本地抓取链之后，产品里不再有任何联网工具，只剩用 `bash` 调 `curl` 或接一个现成的 MCP server（ADR-0010）这类通用通道。这对普通会话还能接受，对子代理却把一个典型的工作形态挡在门外——「联网检索」通常不需要父会话亲自抓网页，它只想把搜索、筛选、阅读、总结这一串委派出去，等一份带来源的汇报。子代理今天既没有这类工具，也没有一个开箱即用、专门做这件事的档案。

**我们决定**把联网能力以**子代理专用工具**的形式加回来，并补齐后端、凭据与内置档案：

## 专用边界：只有 source 为 subagent 的会话注册

新增 `web_search` 与 `web_fetch` 两个自定义工具（`lib/server/web-tools.ts` 的 `createWebSearchTool` / `createWebFetchTool`）。专用语义落在服务端注册层，而不是界面隐藏或提示词劝阻：`lib/server/rpc-manager.ts` 创建会话时用 `subagentWebTools(capturedSource)` 决定是否把这两个工具放进 `customTools`，`user` 与 `scheduled` 源拿到空数组。SDK 的工具 allowlist 与既有的可声明名单收敛照常生效，因此存量选择或 API 直接写入这两个名字的普通会话 / 定时任务会话也启不了它们——展开后没有匹配工具，等价于不选，与 ADR-0011 / ADR-0013 的遗留名称处置一致。

工具目录探测多一个可选的 `source` 参数（`app/api/agent/tools/route.ts` 的 `catalogSource`，缺省与未知值都落回 `user`），子代理档案编辑器以 `source: "subagent"` 起一次临时会话列目录（`components/settings/subagent-config/SubagentToolPicker.tsx`），普通会话的目录仍然看不到这两个名字。两个工具对所有子代理档案开放，不是某个档案的独占配置。

## 后端：DeepSeek Search / Fetch，不重建本地抓取链

搜索与抓取都走 DeepSeek API（`lib/server/deepseek/client.ts` 的 `createDeepSeekClient`）：`POST /v1/tools/search` 收 `query`、`count`、`need_content`，返回每条结果的标题、链接、摘要与可信度字段（`score` / `authority`）；`POST /v1/tools/fetch` 收 `url`，返回页面标题与 Markdown 正文。接口形状与本地 `web-search` 技能一致。请求超时（30 秒）、响应体上限（2 MB）、错误体摘要与输出截断都在客户端侧完成：`web_fetch` 的 `max_chars` 只用于本地截断 Markdown，不发给服务端。

这意味着产品不再替用户取任意 URL，出站目标只剩 DeepSeek API。ADR-0013 删掉的本地 HTML 解析依赖（`readability` / `linkedom` / `turndown`）与 `ssrf.ts` 都不恢复：抓取安全、重定向与页面解析由 DeepSeek 服务端负责，本地不需要再造一道 SSRF 闸门，也不需要为它维护一份允许/拒绝规则。请求走进程的全局 `fetch`，不另建代理客户端，因此跟随 `network_proxy` 已安装的全局 dispatcher（`lib/server/network-proxy.ts`）。

## 凭据：自有数据目录的 0600 key 文件优先于环境变量

密钥属于「界面可填、显式保存」的待保存项，但不进 `config.yaml`：它单独落在 Pi Work 数据目录下的 `deepseek/api-key`（`lib/server/deepseek/credentials.ts` 用 `dataPath("deepseek", "api-key")`，`PI_WORK_DATA_DIR` 可整体覆盖），写入后 `chmod 0600`，形状与频道凭据一致。读取顺序写死在 `loadDeepSeekApiKey`：`readFileKey() ?? readEnvKey()`——界面保存的 key 文件优先，其次回退到服务进程的 `DEEPSEEK_API_KEY`。端点由 `deepSeekBaseUrl()` 决定，`DEEPSEEK_BASE_URL` 覆盖官方默认值 `https://api.deepseek.com`（去掉尾部斜杠）。

设置侧新增「DeepSeek API Key」分区（`components/settings/registry.ts` 的 `integrations` 分组，页在 `components/settings/pages.tsx` → `DeepSeekKeySection.tsx`），草稿本地维护、显式保存，走独立的 `GET/POST/DELETE /api/settings/deepseek-key` 而不是 `PUT /api/settings` 的通用 patch 白名单。读回只给状态与掩码：`••••` 加末四位（密钥不超过四位时只有 `••••`），完整密钥不回传、不落日志；路由日志只记 `configured` 与 `source`。清除只在来源是文件时可用，删掉文件后环境变量会重新成为来源。

## 内置 web_searcher 与种子版本 1 → 2

`lib/server/subagent-profiles.ts` 增加内置档案 `web_searcher`：工具集是独立常量 `SUBAGENT_WEB_SEARCHER_TOOL_IDS`（`web_search`、`web_fetch`、`bash`、`read`、`write`、`edit`），提示词要求先搜索、只抓真正需要的少量页面、汇报附来源链接并区分事实与推断；Pi Bot 沿用默认机制选 `searching` / `cloud`；无人值守档位取默认 `auto_deny`，不特殊提升。它可编辑可删除，`builtin` 仍只是 seed 标记。

种子版本从 1 升到 2，新增 `BUILTINS_ADDED_IN_VERSION_2` 与 `seedsAddedInUpgrade(fromVersion)`：空库种全部；版本 0 的旧库补 0 → 1 的 `implementer` 加 1 → 2 的 `web_searcher`；版本 1 的既有安装只补 `web_searcher`，升级后 `user_version = 2`。插入仍是 `INSERT OR IGNORE`，所以用户改过的同名档案不会被覆盖；升级完成后用户再删除 `web_searcher` 也不会复活。但用户**在升级前**删掉的档案在引入它的那一步会被补回（版本 0 删掉 `implementer` 的旧库会在本次升级补回它），这与 0 → 1 的既有行为相同，不是新引入的回归。

## 提示词指南按会话实际拥有的工具追加

`lib/server/web-tool-guidance.ts` 的 `webToolGuidanceBlocks` 按会话工具集择块，`composeAppendSystemPrompt` 与 `composeOverrideSystemPrompt` 决定它落在哪一层：默认模式接在既有追加块之后，`systemPromptPrefix` 模式只追加联网块，`systemPromptOverride` 模式则把联网块拼到档案的完整覆盖提示词之后。因此 `web_searcher` 这类覆盖模式的子代理会话也能拿到指南，而不是像旧的 `ask_user_questions` / 子代理块那样在覆盖模式下被整体丢弃。

## Considered options

- **普通会话也开放这两个工具。** 那就不再是「子代理专用」：父会话会自己抓网页，委派边界消失，目录探测也不再需要 `source` 参数。将来要开放是另一次决策，不是在今天放宽注册条件。
- **本地 HTML 解析 + 重建 SSRF 闸门。** 这正是 ADR-0013 拆掉的那条链：三个依赖、一份出站规则、一套重定向与内容类型判断，只为了自己取任意 URL。交给 DeepSeek 后端后，本地唯一的出站对象是它自己的 API，闸门没有对应物。
- **环境变量优先于界面密钥。** 那样设置里的保存按钮大概率看不出效果（进程里设了环境变量就永远盖住文件），用户也无法在两种配置共存时预期结果；文件优先让「我刚在界面里改的」总是生效，删除文件即可退回环境变量。
- **复用旧 `fetch_content` 名称。** 旧名绑定的是本地抓取语义（Readability 正文提取），今天的行为是「调 DeepSeek Fetch 并截断」；沿用旧名会让存量选择看起来仍然有效，掩盖能力与后端已经换了的事实。
- **多搜索后端或后端切换配置。** Tavily / Brave / SearXNG 各有自己的请求与返回形状，一套切换层意味着多份密钥、多套错误映射与一份选择 UI；本次只交付一个可用的后端，不预留抽象。
- **某个档案独占这两个工具。** 专用性属于**会话来源**，不属于某个档案；所有子代理档案都应能勾选，`web_searcher` 只是默认配好的一份，不是白名单。
- **把密钥塞进 `config.yaml` 的通用 patch 白名单。** 通用写入路径会把密钥带进每次整份 / 逐 key 的配置写回与日志，且与 ADR-0009 已经收窄的写入口相反；独立凭据 API 让「保存密钥」成为一个显式动作。
- **恢复 `useSettingsWrite.submit` 这条提交通道。** 它只为旧 Tavily staged secret 存在，ADR-0013 已删除；本次让分区自己持有草稿并调用独立凭据 API，不把通用写入模态请回来。

## Consequences

- 行为由测试钉住：`tests/unit/web-tools.test.ts` 钉注册源的三种取值与工具输出 / 错误；`tests/unit/subagent-web-tools.test.ts` 钉普通会话写入工具名后仍不激活、子代理会话可激活、子会话快照往返；`tests/unit/agent-tools-api.test.ts` 钉目录探测的 `source` 参数与缺省回退；`tests/unit/deepseek-client.test.ts` 钉请求形状、字段映射、截断、超时、响应体上限与无密钥错误；`tests/unit/deepseek-credentials.test.ts` 与 `deepseek-key-route.test.ts` 钉 0600、读回、删除、文件优先于环境变量与掩码；`tests/unit/web-tool-guidance.test.ts` 钉三种提示词模式的块位置；`tests/unit/subagent-profiles-store.test.ts` 钉空库 / 版本 0 / 版本 1 的种子结果、用户改动不被覆盖、升级后删除不复活，以及 `web_searcher` 的工具集与提示词要求。
- 存量 `config.yaml` 不需要迁移：本次不新增配置键。存量工具选择里若还有旧的 `web_search` / `fetch_content`，`web_search` 在普通会话里仍然没有匹配工具；`fetch_content` 永不匹配。
- 子代理会话恢复仍走既有快照：创建时的工具集快照决定恢复后的能力，恢复路径同样按 `source` 判定注册；恢复不会悄悄获得或失去联网工具。
- 内置档案目录的系统提示词块预算从 800 字符提高到 900（`tests/unit/subagent-tool-migration.test.ts` 的 `BLOCK_CHAR_BUDGET`）：第四行目录放不下旧预算，常量随档案数量调整，没有改动块的生成逻辑。
- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` 是**服务进程**的环境变量：桌面轨道由 Electron 外壳拉起的服务端继承它自己的环境，服务器轨道继承部署环境；设置里保存的 key 文件在两种轨道下都优先。密钥只在服务端读取，不进入浏览器 bundle（`lib/shared/deepseek.ts` 只有状态类型与默认端点）。
- 工具声明为顺序执行（`executionMode: "sequential"`）并标记 `readOnlyHint` / `openWorldHint`；它们不绕过子代理既有的无人值守档位与危险命令规则，`bash` 命中规则仍按 `auto_deny` 被拒。
- 不在本次范围：普通会话 / 定时任务开放联网工具、本地抓取链、多后端切换、搜索结果缓存与计费、向父会话自动注入结果。
- 术语进 `GLOSSARY.md`：**子代理专用工具**在实现前已补入；本次新增**密钥回退顺序**，描述文件密钥优先于环境变量。

**参见**：ADR-0013（移除 `web_search` 与 `fetch_content`——本文是对它的部分反转：联网能力只以子代理专用工具的形式回来）、ADR-0009（设置项的保存语义由输入形态决定：密钥是待保存项，但走独立凭据 API 而不是通用 patch 白名单）、ADR-0019（设置分区就是页：新增分区同时改注册表与页映射）、ADR-0025（无人值守档位：`web_searcher` 默认 `auto_deny`，新工具不改变危险命令闸门）、ADR-0011（选了没匹配工具即不选：存量名称的处置同此）。
