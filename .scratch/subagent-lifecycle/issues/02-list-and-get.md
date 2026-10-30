# 02: 查询子代理会话、任务详情与结果

Category: enhancement
Status: done

**What to build:** 父 agent 通过 list/get 找回直属子代理会话，查看任务状态、活动、错误和结果；用户看到的子会话列表与工具查询反映同一受管理执行状态。

**Blocked by:** 01: 改名为 subagent，打通创建与独立等待.

**Status:** done

- [x] list 返回当前父会话直属子会话摘要和最新任务，支持状态筛选与分页，不因多轮历史把同一会话重复列为多项。
- [x] get 可用 task_id 查询某任务，也可用 session_id 查询最新任务摘要及分页任务历史。
- [x] 详情包含时间、状态、错误、近期工具活动、结果及可用的异常部分输出；结果与对话记录支持有界分页读取。
- [x] 任何截断均明确标记并提供继续读取方式；列表默认不返回全量 prompt、对话或结果。
- [x] 所有标识查询校验直属归属，已知其他父会话的子标识也不能读取，非法/缺失标识明确失败。
- [x] 现有 UI 子会话列表和活动详情与工具查询使用一致的任务状态来源，不能永远轮询僵死 running 记录。
- [x] 外部接口测试覆盖分页、筛选、截断、部分输出、任务/会话定位和越权访问；多任务历史验收在 continue 可用后完成，不为此增加对 05 的依赖。

## 实现备注

- 查询集中在 `lib/server/subagent-queries.ts`：`list` 按子会话分组（无子会话的排队任务单独成行），`get` 用 `task_id` 或 `session_id` 定位，结果/对话/活动都是有界窗口。
- 「有效状态」由 `resolveSubagentTaskStatus` 给出：终态行保持终态，非终态行只有在任务管理仍持有该任务时才算活着，否则报告 `interrupted`。`/api/sessions/[id]/subagents` 与 `/api/subagents/[sessionId]/activity` 复用同一规则，界面不再无限轮询僵死 running。
- 归属一律以调用上下文的父会话 id 为准；别人的 `task_id`/`session_id` 在本人会话下就是「找不到」，不泄露存在性。
- 截断续读参数：结果用 `result_offset`；对话用 `transcript_offset`/`transcript_limit` 选消息、`transcript_char_offset` 续读单条超长消息。
