# 新 cwd 的默认工具集是 read / write / edit / bash

一个 cwd 没有存过工具选择时，`startRpcSession` 与 `/api/cwd-tools` 都落到 `"all"`：新项目一开口就带着 `subagent`、`memory`、`ask_user_questions`、`celebrate` 以及平台 shell 之外的全部可声明工具。这些工具各自有系统提示词开销与调用面，而新项目最先需要的是读文件、改文件、跑命令这一组核心动作。把「先全开、再逐个关」作为缺省，等于让每个新 cwd 先付一遍全量工具的成本。

**我们决定**：缺省选择收敛为核心四件 `read` / `write` / `edit` / `bash`，其余工具保持可选择、可开启、可关闭。

- `lib/shared/tool-selection.ts` 新增 `DEFAULT_CWD_TOOL_NAMES`，服务端与客户端共用同一份清单；
- `lib/server/cwd-tools-config.ts` 的 `resolveCwdToolSelection(cwd)` 在 cwd 没有存过选择时返回这份清单，`startRpcSession` 与 `GET /api/cwd-tools` 改用它；
- 新建会话草稿的初始工具选择与 `CwdToolsPicker` 的兜底也取同一个常量，避免打开选择器的一瞬先显示 `"all"`；
- 显式写下的选择一律保留：`"all"`、任意数组、空数组（全部关闭）都不被缺省覆盖。

缺省只是**读取时的解析结果**，不写回 `cwd-tools.json`：用户打开选择器原样保存会落成一份显式清单，没打开过的 cwd 始终是「未配置」。

## Considered options

- **继续缺省 `"all"`。** 新 cwd 的第一次会话就带着全部工具与提示词；想收窄的人每次都要手动关一遍，且新工具加入时自动出现在所有新 cwd 里。
- **把默认值写进 `cwd-tools.json`。** 读取配置产生写入副作用，配置目录会凭空长出一堆条目；「未配置」与「显式选择核心四件」也不再有区别。
- **从工具目录里隐藏其他工具。** 那等于删功能；本决定要的是默认收窄，不是取消开启通道。

## Consequences

- 已打开过的会话有 session sidecar（启动时写入当次的有效选择），它们的工具集不变；受影响的只是「没有 sidecar 的会话 + 没有 cwd 配置的 cwd」。
- 定时任务仍以任务自身的 `toolNames`（缺省 `"all"`）为准，子代理仍以档案工具集为准，两处不经过 cwd 缺省。
- `subagent`、`memory`、`ask_user_questions` 等工具不再默认出现在新 cwd 的会话里；用户在选择器中勾选后照常生效，勾满即回到显式 `"all"`。
- `/api/agent/tools` 的临时探测会话继续显式传 `"all"`，工具目录不受缺省影响。
