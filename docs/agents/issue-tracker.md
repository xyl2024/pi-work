# Issue tracker：GitHub

本仓库的 issue 和 spec 以 GitHub issue 形式存在。所有操作使用 `gh` CLI。

## 约定

- **新建 issue**：`gh issue create --title "..." --body "..."`。多行 body 用 heredoc。
- **读取 issue**：`gh issue view <number> --comments`，用 `jq` 过滤评论，同时取 labels。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合 `--label` 和 `--state` 过滤。
- **评论**：`gh issue comment <number> --body "..."`
- **打标签 / 删标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

仓库从 `git remote -v` 推断；在 clone 目录内运行时 `gh` 会自动识别。

## PR 作为分诊入口

**PR as a request surface: no。** _（如果本仓库把外部 PR 当作功能请求，改成 `yes`；`/triage` 会读这个标志。）_

设为 `yes` 时，PR 走与 issue 相同的标签和状态，使用对应的 `gh pr` 命令：

- **读取 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待分诊的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，只保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的（丢弃 `OWNER`/`MEMBER`/`COLLABORATOR`）。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 和 PR 共用一个编号空间，所以裸的 `#42` 可能是其中之一：先 `gh pr view 42`，失败再回退到 `gh issue view 42`。

## 当 skill 说「publish to the issue tracker」

创建一个 GitHub issue。

## 当 skill 说「fetch the relevant ticket」

执行 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一个 issue，**ticket** 是它的子 issue。

- **Map**：单个带 `wayfinder:map` 标签的 issue，body 承载 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **Child ticket**：通过 GitHub sub-issue 关联到 map 的 issue（`gh api` 调用 sub-issues 端点）。未启用 sub-issue 时，把子 issue 加进 map body 的任务列表，并在子 issue body 顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。被领取后分配给推进的开发者。
- **Blocking**：使用 GitHub **原生 issue 依赖**，这是规范且 UI 可见的表示。加边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是 blocker 的数字**数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number` 也不是 `node_id`）。GitHub 通过 `issue_dependencies_summary.blocked_by` 报告（仅未关闭的 blocker，即实时闸门）。依赖功能不可用时，回退为子 issue body 顶部的 `Blocked by: #<n>, #<n>` 行。所有 blocker 都关闭时 ticket 才算解锁。
- **Frontier 查询**：列出 map 下所有未关闭子 issue（`gh issue list --state open`，限定在 map 的 sub-issue / 任务列表内），丢弃有未关闭 blocker（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里仍有未关闭 issue）或已有 assignee 的；按 map 顺序取第一个。
- **领取**：`gh issue edit <n> --add-assignee @me`，这是该 session 的第一次写操作。
- **完成**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，再把上下文指针（要点 + 链接）追加到 map 的 Decisions-so-far。
