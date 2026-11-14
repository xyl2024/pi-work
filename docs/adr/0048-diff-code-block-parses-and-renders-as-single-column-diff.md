# ```diff 代码块按单列 diff 渲染，颜色只来自 token

模型经常在 ```diff 围栏里输出补丁。此前它被交给语法高亮，得到的是一段红绿 token 彩色文本：没有行级底色，`@@ -1,3 +1,4 @@` 原样占一行，读不出「改了什么」。

**决策：diff 渲染在 `useMarkdownComponents` 的语言分派处接入（`diff` 分支），不逐处接线。** 聊天正文、Thinking 块、Markdown 文件预览、Skill 详情、Scheduler 输出共用这个 hook，接入即全部生效。

**决策：解析是 `lib/shared/diff-block.ts` 里的纯函数，不依赖 React/DOM。** 文本解析成文件段、hunk 段与行序列；行类型为文件头、hunk、新增、删除、上下文、元信息；每行带旧行号与新行号（无 hunk 头时不产生行号，不编造）；每文件与整体各有增删计数。文件条、行号列、折叠与统计展示由后续 ticket 消费同一份结构。

**决策：diff 块不走 Prism，行内容按纯文本渲染。** Prism 的 `inserted`/`deleted` token 着色与行级底色叠加会得到两种「差不多的绿」叠在一行上；配色由行分类决定，一行一个语义。

**决策：红绿只来自 token 层。** 新增 `--diff-add-bg` / `--diff-add-text` / `--diff-del-bg` / `--diff-del-text` / `--diff-hunk-bg`，亮暗主题各一组，基准取现有 `--success` / `--error` / `--info` 体系；组件内不出现色值字面量。后续 Git 面板 diff 视图应改用同一组 token（本 ADR 范围外）。

**决策：不可渲染就静默回退普通代码块。** 内容里没有任何新增/删除行（纯文字解释）、空输入或畸形内容时，解析返回 `renderable: false`，渲染层原样回退到 `CodeBlock`（语言标签与高亮保留），不出现「解析失败」之类的噪音 UI。

hunk 头渲染成弱化分隔条而不展示 `@@` 原文；`diff --git`、`index`、`mode`、`\ No newline at end of file` 等元信息不产生正文行；无法归类的行按上下文样式保留，内容不凭空消失。

## Considered options

- **在 Prisma 高亮上叠行级底色。** 实现最省，但 token 红绿文字与行底色语义重叠，暗色下尤其脏；弃。
- **把解析逻辑写在组件里。** 无法在无 React 环境下单测，且后续 ticket 的统计、折叠判定都会把组件撑胖；弃。
- **解析失败时报错或提示。** 模型在 ```diff 围栏里写普通文字是常见行为，不是错误；回退成普通代码块是最接近用户预期的呈现。
