# 系统提示词由 Pi Work 自己拼，pi 的内建段落降为它的原料

想调整 agent 的行为，以前要在四个互不相干的地方下手：`~/.pi/agent/APPEND_SYSTEM.md`（只能整段追加在末尾）、斜杠命令的 Prompt 模板、子代理档案的 `systemPrompt`、以及写死在代码里的工具说明块。而段落顺序由 pi 完全写死（preamble → tools → rules → docs → addendum → project_context → skills → cwd），既插不进中间，也动不了别段；用户想读最终提示词只能翻 Context 面板。

我们决定：**Pi Work 自己复刻 pi 的装配顺序与规则，渲染整条系统提示词，把 pi 的内建段落降为它的原料**。设置里给一条有序的片段列表（`system_prompt_template`），每项要么是自定义文本（可带可选 tag），要么是一个变量（`preamble` / `tools` / `rules` / `docs` / `addendum` / `project_context` / `skills` / `model` / `thinking_level` / `date`）。默认模板逐字等于 pi 原来拼出来的那条，所以什么都不改就什么都不变。渲染规则全部住在一个纯模块（`lib/shared/system-prompt-template.ts`），交付点只有一处，`APPEND_SYSTEM.md` 与 `append_system.enabled` / `load_pi_docs` / 「工具全空则置空」三个开关一并退役。

## 几条反直觉事实（写下来免得后人踩）

1. **`customPrompt` 会顶掉 `<tools>` / `<rules>` / `<docs>`。** pi 的 `buildSystemPromptSections` 里，`customPrompt` 只要为真，这三个 section 就整体不再生成——不是覆盖内容，是压根没有。Pi Work 因此必须自己写出同名 tag（`<tools>` 等）才能让 transcript、Context 面板与模型所见三者一致。
2. **交付是 `event.systemPromptOptions` 的原地 mutation，不是 `return { systemPrompt }`。** 后者走 `forceSystemPrompt`：provider 请求会看到那段不透明文本，而 transcript 仍按分段 diff 记录，两边分叉。用 `customPrompt` 则两边同源。唯一的例外是「模板渲染结果为空」——那时 `customPrompt: ""` 会让 pi 静默退回它自己的默认段落，所以这一种情况**故意**再返回 `{ systemPrompt: "" }`（`forceSystemPrompt` 用 `!== undefined` 判定，空串有效），让「模型失去全部指引」与用户的警告一致。
3. **末尾那个 `<cwd>` 拦不住。** pi 无条件赋值 `promptSections.cwd` 且永远排在末尾，所以「任意顺序」对 cwd 不成立，模板里干脆没有 cwd 变量。读侧（Context 面板 / `get_state` / BTW）用 `composeSystemPrompt` 在渲染结果之后补上它；而交付给 `customPrompt` 的必须是**裸渲染**——把补过的结果塞进去会让 cwd 段出现两次。
4. **`APPEND_SYSTEM.md` 退役。** loader 构造时无条件收到 `appendSystemPrompt: []`（空数组在 JS 里为真，因此 pi 的 `discoverAppendSystemPromptFile()` 分支被跳过），全局与项目级两份文件都不再被读；文件原样留在磁盘上，不自动迁移、不自动导入模板。内置工具说明块仍由 `appendSystemPromptOverride` 生产，成为 `addendum` 变量的值。
5. **抄来的文案会随 pi 升级漂移。** persona 句、`<tools>` 尾巴、`<docs>` 正文、`buildRules` 的基础规则、`formatSkillsForPrompt` 都是复刻，唯一防线是一条与 SDK `buildSystemPrompt` 逐字对拍的测试（`tests/unit/system-prompt-template.test.ts`）。那条测试允许深路径 import `dist/core/system-prompt.js`，生产代码不可以。

## 已知代价

- 模板在**会话创建时快照**，改完必须开新会话才生效；界面明说这一点。变量数据（工具清单、追加块、项目上下文、技能）每轮实时取，所以会话中切换工具集会让提示词里的工具清单跟着变。
- 整条提示词进 `customPrompt` 后，transcript 里只剩一个 `preamble` section，pi 的分段机制在这里退化为单段。这不影响 prompt cache（system message 变了本来就是全失效），也不是卖点。
- 不再有代码兜底「工具集为空」：模板里就直接没有工具段（pi 会输出 `<tools>(none)</tools>`，Pi Work 整块不输出——这是有意的行为差异，对拍测试因此只以非空工具集为条件）。
- 子代理会话不套模板，仍走档案 `systemPrompt` + `stripDefaultSystemPromptSections`；主会话的编排不会污染窄任务。

## Considered options

- **继续在 pi 的渲染结果上做后处理（切段/替换/追加）。** 实现最省事，但正是不够用才要改：插不进中间、动不了别段，且 pi 一升级就碎。前面已经有三处这种后处理（`stripDefaultSystemPromptSections`、`stripPiDocumentationSection`、空工具集置空），越堆越脆。
- **用 `forceSystemPrompt` 交付整条提示词。** provider 请求与 transcript 分叉：transcript 里还是 pi 的分段，面板与模型看到的两条东西，正是这个功能要消掉的问题。
- **回写 `~/.pi/agent`，让 pi CLI 与 Pi Work 共用同一份模板。** 出范围，而且会改用户的 pi 配置——两条使用路径各自可预期更好。
- **把 `APPEND_SYSTEM.md` 的内容自动导入模板。** 静默改用户的配置，且模板里的位置无法猜测。留在磁盘上，设置页给一条指引。
- **`customPrompt` 之外再暴露「重载当前会话」。** 会话创建时快照是简单且可解释的语义；热重载要重放 transcript 并把 `customPrompt` 的历史改成新值，代价远大于收益。

## Consequences

- 「谁能决定 agent 的行为」从「pi 的装配 + 四处追加」收敛成「一条有序片段列表 + 一处渲染」；渲染规则是纯函数，可以不起服务就测。
- `CONTEXT.md` 的「追加系统提示词（Append System）」这一条退役，新增「系统提示词」「系统提示词模板」「系统提示词片段」。
- ADR-0009 里写死的 `PUT /api/settings` 归属 key 集合因此变化（见该文末尾的 Update）。
- 变量名沿用 pi 的段名，模板与 pi 文档能对上号；但 pi 升级若改了段名，已验证的映射会失效——映射由 `tests/unit/system-prompt-template.test.ts` 钉住，升级时先看那条测试。
