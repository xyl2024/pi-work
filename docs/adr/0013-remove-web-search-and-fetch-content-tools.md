# 移除 web_search 与 fetch_content 工具

`web_search` / `fetch_content` 是内置进产品的一对联网工具：`lib/server/web-access/tools.ts` 用 Tavily API 提供搜索，并在 `rpc-manager` 里按会话工具选择追加各自的系统提示词块；`fetch-content.ts` 用 `@mozilla/readability` + `linkedom` + `turndown` 把网页转成 Markdown，`ssrf.ts` 是两者共用的出站取回闸门。配置侧有 `web_access`（`enabled` + `tavily.api_key`）、Settings → Web Access 的 API Key 表单与 `POST /api/settings` 的掩码读/显式清除语义，工具选择器的 Assistant 预设也把这两个名字写进了模式串。

它们把「联网检索」绑死在一个第三方 key 上：没配 Tavily 就是不可用，配了就把搜索原文与网页正文整段塞进上下文；而同一能力今天可以用 `bash`/`codemode` 直接调 `curl`、或接一个现成的 MCP server（ADR-0010）覆盖，不必让核心依赖里常驻一个 HTML 解析链。

**我们决定**把它整套删掉，而不是默认关闭：

- 删除 `lib/server/web-access/`（`tools.ts` / `fetch-content.ts` / `ssrf.ts`）与 `rpc-manager` 里的注册、两个系统提示词块；
- 删除 Settings → Web Access 区（`WebAccessSection`、registry 条目、`SettingsSectionId` 成员）与 `web_access` 配置键：`config-types` 的类型、`lib/server/config.ts` 的默认值与 `parseWebAccess`、`/api/settings` 的校验/掩码读/Tavily 合并写入、`settings-keys` 的 owned key；
- 从此没有任何调用方需要「提交显式 patch + 乐观状态」这条写入路径，`useSettingsWrite.submit` / `SettingsSubmit` 一并删除，只保留 `apply`；
- Assistant 工具预设里去掉 `web_search` / `fetch_content`；
- 卸载 `@mozilla/readability`、`turndown`、`@types/turndown`、`linkedom`，并清理 `pnpm-workspace.yaml` 注释里对 linkedom 的引用。

## Considered options

- **保留、默认关闭。** `web_access.enabled` 已经能关，但依赖链、设置区、密钥读写语义一条都不会少；默认关闭只是把「不可用」藏进一个开关。
- **只删 `web_search`、留 `fetch_content`。** `fetch_content` 自己就是 `readability`/`linkedom`/`turndown` 三件依赖的全部理由，留下它等于留下整条 HTML 解析链，且它单独存在时仍要一个抓取闸门（`ssrf.ts`）。
- **改成 MCP server 接入。** 真要再用搜索/抓取，装一个 MCP server 是配置而不是发版（ADR-0010）；本次不预置这个 server，避免把「已删除」变成「换个地方默认开着」。
- **保留 `submit` 写入模态作为通用能力。** 它只为 Tavily 的 staged secret 存在，删掉它反而让 `useSettingsWrite` 只剩一条路径，语义更窄也更清楚。

## Consequences

- 存量 `config.yaml` 里残留的 `web_access` 块不再被解析；`readConfig` 类型里没有它，下一次 `PUT /api/settings`（从磁盘 overlay 后写回）会顺手把它清掉，不需要迁移代码。
- 存量会话或 cwd 工具选择里若还有 `web_search` / `fetch_content`，前缀展开后没有匹配工具，等价于不选——与 ADR-0011 的 CodeGraph 处置相同。
- ADR-0009 里 `PUT /api/settings` 拥有的 key 列表少一个 `web_access`；「动词 PUT、语义 PATCH」的结论本身不变。
- 出站 `fetch` 的 SSRF 防护随 `ssrf.ts` 一起消失；这是**有意**的，因为产品不再替用户取任意 URL。网络代理（`network_proxy`）不经过该模块，不受影响。
