# 移除 MCP 面板与 codemode 工具

MCP 一度是 Pi Work 的一等面板视图：`components/panels/McpPanel.tsx` 与 `components/panels/mcp/` 提供列表页 / 条目页，`lib/server/mcp-config.ts` 镜像 pi 的 loader 与校验器，`lib/server/mcp-entries.ts` 做保留式读-改-写，`app/api/mcp/route.ts` 是唯一写口，客户端状态在 `lib/client/mcp-panel.ts` 与 `lib/shared/mcp-draft*.ts`，右栏按钮、命令面板与 `config.yaml` 的 `mcp` 键都挂在同一套注册表上。与此同时 `rpc-manager` 无条件注册 pi 的 `createCodemodeExtension()`，`codemode` 因此始终是一个可被模型调用的内置工具；聊天视图、工具分类、子代理档案与工具选择器都各自有一条针对它的分支。

这两块都不再是产品要维护的界面与工具：MCP 的连接、配置语义与版本兼容全部由 pi 自身承担，Pi Work 再镜像一套 loader / 校验器 / 写盘路径，只会把上游的字段变化变成自己的回归；`codemode` 则把「写一段代码再执行」叠在 `bash` 之上，工具的上下文成本与执行面都比核心四件套更大。我们决定连同它们的入口、状态、配置与渲染一起删掉，而不是隐藏或默认关闭。

**我们决定**：

- 删除 MCP 面板的全部实现：`components/panels/McpPanel.tsx`、`components/panels/mcp/`、`lib/client/mcp-panel.ts`、`lib/client/mcp-io.ts`、`lib/shared/mcp-panel.ts`、`lib/shared/mcp-draft.ts`、`lib/shared/mcp-drafts.ts`、`lib/shared/mcp-close.ts`、`lib/server/mcp-config.ts`、`lib/server/mcp-entries.ts`、`app/api/mcp/route.ts`，以及只服务它的 `hooks/usePanelViewLifecycleSync.ts`。
- 从注册表里摘掉 `mcp`：面板 kind、右栏按钮、命令面板条目、`MCP_TAB_ID`、`PiWorkConfig.mcp` 与 `parseMcp`、`McpConfig` 类型、`McpIcon`、`RightBarCtx.mcpDirty` 与右栏角标机制，以及中英文 `mcp.*` 词条。
- 从 `rpc-manager` 摘掉 `createMcpExtension()` 与 `createCodemodeExtension()` 的注册、`options.mcp` 开关、`mcpProjectServers` / `mcpStartupWaitMs` 的读取，以及 MCP 专用的 `bindExtensions` 调用。
- 从工具面摘掉 `codemode`：`lib/shared/tool-call-display.ts` 的分类、`components/chat/message-view/blocks.tsx` 的专用渲染、`ToolExposure` 的 `codemode` 档位、内置 `implementer` 档案的默认工具集。
- 删除对应单测（`tests/unit/mcp-*.test.ts`）并把其余测试里把 `mcp` / `codemode` 当样例数据的地方换成仍然存在的面板与工具。

**不动用户数据**：`~/.pi/agent/mcp.json`、`<cwd>/.pi/mcp.json` 与用户 `config.yaml` 里已有的 `mcp` 键原样留在磁盘上。Pi Work 不再读取或写入它们，但也不会替用户删除；上游 pi 的 CLI / TUI 仍可直接使用这些文件。

## Considered options

- **保留面板、默认隐藏。** 注册表、API、镜像 loader、i18n 与写盘路径一条都不会少，只是把入口藏起来；上游字段一变，隐藏的代码照样要跟着改。
- **只删界面、保留 `mcp` 配置键与扩展注册。** 等于让会话继续连接用户看不见也管不了的服务器，工具面与权限面反而更不可解释。
- **只删 `codemode`、保留 MCP 的 `exposure` 档位。** MCP 已经整体移除，暴露级别也随之失去调用方；留下一个永远不会被解析的字符串只会误导下一次改动。
- **顺手清理用户的 `mcp.json` 与 `config.yaml`。** 那是用户数据，且 pi 自身仍会读取；删除 UI 不等于授权 Pi Work 改用户磁盘上的配置。
