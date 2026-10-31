# 移除 CodeGraph 工具家族

CodeGraph 是内置进产品的一套语义代码智能工具（`lib/server/codegraph-tool.ts` 驱动 `@colbymchenry/codegraph` SDK 的 MCP ToolHandler，进程内注册 9 个 `codegraph_*` 工具），配套一条工具市场分类、一段共享追加系统提示词、一道 `codegraph_build` 权限闸门，以及工具选择器里的「绑定工具组」折叠。

它的接入成本却在核心之外铺得很开：平台包名必须在 `next.config.ts`（webpack external）与 `lib/server/codegraph-sdk.ts`（运行时深 require）两处逐字一致，为此单开 `lib/shared/codegraph-platform.ts` 并由测试钉住；pnpm 隔离布局下平台包要靠 `publicHoistPattern` 提升；SDK 捆绑的 tree-sitter 是 V8-ABI 原生模块，逼得 Electron 外壳必须另起 `resources/runtime/` 的独立 Node 运行时；依赖装完是每个平台+架构一份预编译 bundle。收益（符号搜索、调用链、影响面）在今天可以由 `read`/`grep`/`codemode` 加一个 MCP server 覆盖，不再值得占着核心依赖与打包约束。

**我们决定**把它整套删掉，而不是再养着：

- 删除 `lib/server/codegraph-{tool,sdk}.ts`、`lib/shared/codegraph-{platform,tool-ids}.ts`、工具市场的 9 个条目与共享追加块、`rpc-manager` 里的家族注册与 `codegraph_build` 权限闸门、子代理默认工具里的家族成员、相关 i18n 词条、`scripts/test-codegraph-tools.mts` 与两个平台/external 测试；
- 卸载 `@colbymchenry/codegraph` 依赖，撤掉 `pnpm-workspace.yaml` 的 `publicHoistPattern` 与 `next.config.ts` 的 external 条目；
- `TOOL_GROUPS`（工具选择器的绑定家族注册表）机制保留但清空——它是通用能力，只是唯一成员来自 CodeGraph；
- 本机可再生的 `.codegraph/` 索引与 `.gitignore` 条目一并清掉。

## Considered options

- **保留、只是默认关闭。** 原生依赖、平台包名双写、Electron 独立运行时的约束一条都不会少，还要继续维护「项目未索引时返回指引而不硬失败」的那套分支。
- **只删工具、留 SDK 与平台包。** 依赖树没瘦，反而多出一份无人调用的 loader。
- **改成 MCP server 走 MCP 面板接入。** pi-work 已能自己读写 `mcp.json`（ADR-0010），真要再用 CodeGraph，装一个 codegraph MCP server 是配置而不是发版；它不该是核心依赖。本次不预置这个 server，避免把「已删除」变成「换个地方默认开着」。
- **保留 `codegraph_build` 闸门作为通用危险工具闸门。** 它只匹配 `codegraph_build` 一个工具名，随工具一起删；闸门结构（`InteractionGates`，ADR-0008）不变。

## Consequences

- ADR-0001 里「子代理不能依赖交互确认」那条规则的示例（`codegraph_build` 从默认工具集排除）随工具消失，规则本身不变：`SUBAGENT_READ_ONLY_TOOLS` 仍然只有只读核心 + 平台 shell。
- 工具选择器的绑定家族机制（`TOOL_GROUPS` / `buildToolChecklistRows` / `toggleSelectionEntry` 的 group 分支、`ToolCheckRow` 的 `memberCount` 徽标）暂时没有成员，是本仓库已知的空注册表；注册新家族时不需要改机制。
- Electron 外壳仍必须用独立 Node 运行时：`better-sqlite3` 与 `node-pty` 的 ABI 理由不变。
- 存量会话若曾选择 `codegraph_*` 模式，前缀展开后没有匹配工具，等价于不选——不需要迁移代码。
