# Issue tracker：本地 Markdown

本仓库的 issue 和 spec 以 markdown 文件形式存在 `.scratch/` 下。**不使用 GitHub Issues**，不要调用 `gh issue`。GitHub remote 只用于代码托管和 PR。

## 目录约定

- 一个 feature 一个目录：`.scratch/<feature-slug>/`
- spec 是 `.scratch/<feature-slug>/spec.md`
- 实现 issue 是每个 ticket 一个文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号；**永远不要**写成一个合并的 tickets 文件
- 分诊结果写在 issue 文件靠上的两行：`Category:` 记类别角色（`bug` / `enhancement`），`Status:` 记状态角色（值见 `triage-labels.md`）；一条 issue 各一条
- 被拒的 enhancement 把理由写进 `.out-of-scope/<slug>.md`（同一请求再有第二次就靠它拦住），issue 里链接过去再关；被拒的 bug 只在 issue 里解释，不进这个知识库
- 评论和对话历史追加到文件底部的 `## Comments` 标题下

## 操作

- **新建 issue**：在 `.scratch/<feature-slug>/` 下创建文件（必要时先建目录，slug 用小写连字符）。
- **读取 issue**：直接读引用的路径；用户通常会给路径或 issue 编号。
- **列出 issue**：`ls .scratch/<feature-slug>/issues/`，再用 `grep -H '^Status:'` 过滤状态。
- **打标签 / 改状态**：编辑文件里的 `Status:` / `Category:` 行。
- **评论**：在文件末尾 `## Comments` 下追加。
- **关闭**：把 `Status:` 行的值改成 `wontfix` 之类，或按需删除文件；不要删除他人未完成的 ticket。

## PR 作为分诊入口

**PR as a request surface: no。** 本地 tracker 不参与 PR 分诊。

## 当 skill 说「publish to the issue tracker」

在 `.scratch/<feature-slug>/` 下新建一个 markdown 文件。

## 当 skill 说「fetch the relevant ticket」

读取对应路径的文件。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一个文件，**ticket** 是每个 ticket 一个子文件。

- **Map**：`.scratch/<effort>/map.md`，承载 Notes / Decisions-so-far / Fog。
- **Child ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 编号，body 里写问题。`Type:` 行记录类型（`research`/`prototype`/`grilling`/`task`），`Status:` 行记录 `claimed`/`resolved`。
- **Blocking**：靠上的 `Blocked by: NN, NN` 行。它列出的每个文件都是 `resolved` 时 ticket 才算解锁。
- **Frontier 查询**：扫 `.scratch/<effort>/issues/`，找 open、未阻塞、未领取的文件；编号最小的优先。
- **领取**：把 `Status:` 改成 `claimed` 并保存，这是该 session 的第一次写操作。
- **完成**：在 `## Answer` 标题下追加答案，`Status:` 改成 `resolved`，再把上下文指针（要点 + 链接）追加到 `map.md` 的 Decisions-so-far。
