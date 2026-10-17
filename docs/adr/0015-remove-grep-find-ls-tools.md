# 移除 grep / find / ls 工具

`grep`、`find`、`ls` 是 pi 内建注册表里的搜索与列目录三件套：`rpc-manager` 既没有注册它们、也没有排除它们，pi 按 cwd 直接把它们放进每个会话的注册表；「只读探索核心」`SUBAGENT_DEFAULT_TOOL_IDS` 里三件都在；工具选择器把它们当作和 `read`、`bash` 一样的可勾选行。

三件的活都能由 `bash` 一条命令做完（`grep -rn` / `find` / `ls`），而 `bash` 本来就是每个平台、每个会话都有的工具。留着它们要付两份成本：

- 每个会话、每次请求的系统提示词里多三份工具描述，以及对应的一套「什么情况下该用哪个」的取舍负担；
- 同一份文件系统上的第二套口径：`grep` 100 条匹配 / 50KB、`find` 1000 条结果 / 50KB、`ls` 500 条目 / 50KB，与 `bash` 的截断是两套规则，模型得同时记住「我看到的是全部还是前 N 条」。而「不可被选择」这件事本身要在三处保持一致——`get_tools` 的清单、工具选择器的复选框、`all` 选择的展开——少三个名字就少三处对齐。

**我们决定**把这三件从会话的工具注册表里彻底摘掉，而不是默认不勾选：

- 新增 `lib/server/agent-tool-denylist.ts`：`REMOVED_AGENT_TOOL_NAMES = ["grep", "find", "ls"]`，由 `agentToolDenylist(platform)` 把「这个平台跑不了」（`lib/shared/agent-shell-tools.ts`）与「产品不发」两条理由合成一个清单，`rpc-manager` 把它交给 `createAgentSession` 的 `excludeTools`。排除落在注册表上，而不是只过滤 UI 的清单；
- `SUBAGENT_DEFAULT_TOOL_IDS` 只剩 `read`：新建档案的默认工具集变成 `read` + 平台 shell，两个内置档案的系统提示词本来就写着「Use bash for inspection only」，不改；
- **`read` 保留。** 按行区间读文件内容是 `bash cat` 替代不掉的（行号、区间语义、以及「读到多少」的确定口径），它是这套只读核心里唯一没被 `bash` 覆盖的一件。

## Considered options

- **保留、默认不勾选。** 三份工具描述照进系统提示词，两套截断口径照旧并存，三处一致性照旧要维护；默认不勾选只是把「不用」藏进一个默认值。
- **只从工具选择器的 catalog 里过滤掉。** 选 `all`、或存量会话与 cwd 配置里带着这三个名字时，它们仍然生效——「不再可被选择」和「仍然可用」会同时成立。ADR-0011 与 ADR-0013 的处置都否掉了这条路。
- **删工具、留名字，交给 pi 的 `allowedToolNames` matcher 静默忽略。** 那等于让每个 `get_tools` 调用都去证明一个不存在的名字是安全的；注册表里没有就是没有。
- **连 `read` 一起删，只留 `bash`。** 读文件的区间与截断语义会全部落进模型自己写的 `sed`/`head` 里，代价明显大于收益。
- **改成 MCP server 提供搜索。** 真要再用搜索，装一个 MCP server 是配置而不是发版（ADR-0010）；本次不预置，避免把「已删除」变成「换个地方默认开着」。

## Consequences

- **丢掉的是 `.gitignore` 感知，不是能力。** 这三件工具底层走 `fd` / `ripgrep`，默认跳过被忽略的文件；`bash` 覆盖它们的写法（`grep -r`、`find .`）不跳，模型得自己写 `git grep`、`rg` 或 `fd`，或者补 `--exclude-dir`。目录列表也从「500 条上限 + 按字母序 + 目录带 `/` 后缀」变成 `ls` 的裸输出。这是这次移除**有意**接受的口径变化：`bash` 的输出就是用户自己敲那条命令会看到的东西。
- 存量会话、cwd 工具选择与子代理档案里残留的这三个名字，前缀展开后没有匹配工具，等价于不选——不需要迁移代码，与 ADR-0011 / ADR-0013 相同。
- 历史 transcript（含 pi CLI 直接产生的会话）里仍然有这三个工具的调用。`getToolPreview` 与 `ToolCallBlock` 的渲染分支保留 `find` / `grep` / `ls`，老会话与 `pi` 自己的会话回放时预览不变；`classifyToolCall` 不需要改，它们本来就落在 `"other"`。
- `SUBAGENT_DEFAULT_TOOL_IDS` 的注释里「只读探索核心」现在只有一项，名字照旧；`lib/server/agent-tool-denylist.ts` 与 `lib/shared/agent-shell-tools.ts` 的分工是「产品不发什么」与「平台有没有」，两条理由在前者合成。
- 目录列表不再有内置上限这一层保护：`bash ls` 一个超大目录的输出由 `bash` 工具自己的截断（2000 行 / 50KB，取尾）兜底。
