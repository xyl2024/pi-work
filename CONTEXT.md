# Pi Work

pi coding agent 的 Web UI：会话浏览与实时对话、工作目录下的文件操作，以及一组辅助面板。

## Language

### 工作区

**工作目录（cwd）**：
定位一个会话及其文件操作的绝对目录路径。
_Avoid_: space、project、项目

**工作目录分组（Workspace）**：
侧栏中按 cwd 聚合的一组会话，是 `/api/workspaces` 返回的单元。
_Avoid_: 用 Workspace 指代磁盘路径

### 运行环境与信任

**信任边界（Trust boundary）**：
决定「谁可以访问这个进程、谁签发会话」的那一处规则，对应代码中的 `lib/shared/trust-boundary.ts`（纯 module）。两条轨道共用同一套 cookie、路由与客户端调用，只有签发方不同：**服务器轨道**（默认）的会话密钥来自 `PI_WORK_AUTH_*`，登录页可用；**桌面轨道**（`PI_WORK_DESKTOP`）由外壳每次启动生成的随机值（`PI_WORK_DESKTOP_SECRET`）签发并注入 cookie，登录页关闭、服务只绑 loopback。
_Avoid_: 把它当作登录页（那只是服务器轨道签发信任的一个入口）；用「鉴权」泛指它（那只是 401 与登录那一层）

**桌面轨道（Desktop track）**：
Pi Work 由 Electron 外壳拥有并拉起的那条运行方式（`PI_WORK_DESKTOP`）：服务端原生跑在 Windows 上、只监听 loopback、信任凭据每次启动随机生成、没有登录页。外壳用自己捆绑的独立 Node 运行时跑生产服务端（不是 Electron 自带的 Node，原生模块不必按 Electron ABI 重编译），端口每次启动随机，退出时结束整个进程树；窗口与应用寿命是两件事——关窗只把窗口藏进托盘，服务端与它里面的后台循环（定时任务、RSS、看板、频道）继续跑，只有托盘「退出」才结束进程树。决策在 `electron-shell/server-process.js` 与 `electron-shell/lifecycle.js`。它与**服务器轨道**（用户自己部署的 Linux 服务器，保留登录页与 `PI_WORK_AUTH_*`）共用同一份代码。
_Avoid_: 把它当作「桌面版 UI」或第二条代码分支；用「本地模式」指代它

### 界面

**会话标签页（Session tab）**：
聊天区顶部标签条中的一项，承载一个会话或一个草稿。
_Avoid_: 单独用「标签页」指代它（那是面板标签页）

**草稿（Draft）**：
已打开的会话标签页，但还没有对应的会话，只绑定了一个 cwd。
_Avoid_: 草稿会话、未命名会话

**面板标签页（Panel tab）**：
面板顶部标签条中的一项，承载一个文件预览或一个面板视图。
_Avoid_: 与「会话标签页」混用「标签页」

**面板（Panel）**：
聊天界面中可整体显示/隐藏、可展开的那块区域；只有一个，其内容由面板标签页填充。
_Avoid_: 用「面板」指代其中的某个视图

**面板视图（Panel view）**：
面板标签页所承载的单个工具界面，如翻译、Token 审计、看板。
_Avoid_: 用「面板」指代它

**面板标签条（Panel tab strip）**：
承载面板标签页的那条标签条，以及它的状态机：打开、激活、关闭、收起/展开。对应代码中的 `panelTabs`（纯 `lib/shared` registry + reducer）。文件预览标签页与面板视图标签页同处这一条标签条，因此「关掉最后一个标签就收起面板」「点已激活的标签就收起」都由它一条规则决定。
_Avoid_: 用「标签条」裸指它（会话标签页另有一条）；把它当作面板（区域）或面板视图（内容）

**终端面板（Terminal panel）**：
独立的终端界面，附在工作区列上，不属于面板。
_Avoid_: 把它当作面板的一个视图

**命令面板（Command palette）**：
全局命令入口，与面板无关。
_Avoid_: 用「面板」指代它

**会话列（Chat column）**：
承载会话卡片（会话标签页与聊天）的那一列。
_Avoid_: 左列、右列

**工作区列（Work column）**：
承载文件 / 面板卡片与终端的那一列。
_Avoid_: 左列、右列

**布局模式（Layout mode）**：
决定会话列与工作区列谁在左、谁在右的用户设置，取值为 Agentic（会话列在左）与 Classic（工作区列在左）。
_Avoid_: 用「左右」推断某一列或面板的位置

**右侧按钮列（Right bar column）**：
应用窗口最右缘的按钮竖列，用于开合面板、展开/折叠面板、切换面板标签页；两种布局模式下位置不变。
_Avoid_: 右栏、侧边栏（那指会话侧栏）

**会话绑定按钮（Session-bound button）**：
内容随当前会话变化的右侧按钮；没有选中会话时没有内容可显示。
_Avoid_: 把全局按钮算作会话绑定

**全局按钮（Global button）**：
与当前会话无关、任何情况下都可用的右侧按钮。
_Avoid_: 用「工具按钮」指代它

**Pi Bot**：
左侧边栏中的动画伴侣组件（外观、表情、动作可配置）。界面文案用 Pi Bot，代码符号用 GrokBot / grokbot，两者是同一个东西。
_Avoid_: 把它当作 agent、频道、消息来源或会话状态

### 会话

**会话（Session）**：
pi 的一次持久化对话单元，对应一个 JSONL 会话文件、界面中的一个会话标签页，以及进程内的 `AgentSessionWrapper`。
_Avoid_: conversation、对话、chat

**对话（Conversation）**：
会话内部由消息与分支组成的对话历史；对话树（Conversation Tree）是它的一种视图。
_Avoid_: 用 conversation 指代整个会话

**回合（Turn）**：
向一个会话投递一次输入、直到该会话彻底结束（不再有待重试、压缩重试或排队续跑）的完整过程；聊天里的一轮对话与后台任务的一次执行都是回合。
_Avoid_: 把它当作 pi SDK 的 turn（那是一步 assistant 响应加其工具调用）；用裸的 run / 「运行」指代它

**上下文窗口（Context Window）**：
会话当前送入模型的上下文内容与容量；压缩（compact）是对它的操作。
_Avoid_: context、Context 面板视图、React Context

**上下文构成（Context Composition）**：
一个上下文窗口由哪些来源组成、各占多少；来源分为基础系统提示、项目上下文文件、Skills、系统工具定义与各类消息。
_Avoid_: 用「Token 构成」指代它（那属于 Token 审计）；把它当作上下文窗口本身

**会话事件（Session event）**：
服务端推给客户端的一条会话进展事实。它的类型清单就是这份协议本身：客户端对每一条要么归约进会话运行时状态，要么显式列为「知道、但故意不处理」。
_Avoid_: 用裸的「事件」指代它；把它当作 pi SDK 的 `AgentSessionEvent`（那份类型在 wrapper 边界就被丢弃，不是本项目的协议）

**会话运行时状态（Session runtime state）**：
客户端从会话事件流归约出的「这个会话现在是什么样」：回合进行到哪一步、有哪些工具调用在飞、待重试信息，以及消息与对话树的当前视图。
_Avoid_: 与「上下文窗口」混用（那是一个真实的容量，这是客户端的认知）；用裸的「状态」指代它（那是 React state）；把它与 `AgentRuntimeState` 划等号（那是 REST 快照的 payload，只是它的一部分）

**对话时间线（Chat timeline）**：
聊天窗口从会话的对话投影出的渲染视图：哪些消息可见、会话条目索引与可见索引如何互换、工具调用落在哪个可见索引，以及回放按索引裁剪出要渲染的那段。
_Avoid_: 用「视图模型」「消息列表」泛指它；把它当作对话（那是数据，这是投影）

**工具调用展示（Tool call display）**：
把一次工具调用投影成界面卡片所需的事实：它属于哪一类（读文件 / 改文件 / bash / 子代理 / 其它）、增删行数取哪个来源、结果是否算空，以及一个回合内读改文件与增删的合计。对应代码中的 `lib/shared/tool-call-display.ts`（纯 module）。
_Avoid_: 把它当作「对话时间线」（那是可见性与索引投影）；把它与「工具调用统计」面板视图混用

**消息内容（Message content）**：
从一条消息里抽取展示所需的内容事实：文本、图片数量、内容块数量与字符数。对应代码中的 `lib/shared/message-content.ts`（纯 module）。
_Avoid_: 与「工具调用展示」混用；用「消息」泛指它

**会话内搜索（In-session search）**：
在单个会话的对话里按关键字查找消息、并跳转到命中所在分支的入口（Ctrl+F）。
_Avoid_: 与会话库、会话列表的搜索混用

**回放（Replay）**：
会话已停止时按索引顺序重看这段对话历史的只读模式。
_Avoid_: 把它当作分支导航、压缩或 BTW

**自动起名（Auto-naming）**：
会话在第一条助手回复落地后自动生成并写入名字；也可由用户手动触发，覆盖已有名字前需确认。
_Avoid_: 与「重命名」混用（那是用户直接改名）；把它当作会话标题的来源

**BTW（By the way）**：
与当前会话上下文绑定、只读且不写入主会话的侧边临时对话，只持久化在浏览器 localStorage 中。
_Avoid_: 把它当作会话、分支或子 agent

**收藏（Favorite）**：
用户标记的会话，保存在 `favorites.json` 的 sessionIds 中。
_Avoid_: 用它指代工作目录

### 子代理

**子代理（Subagent）**：
由某个会话通过 `spawn_subagent` 工具启动、拥有自己的 pi 会话文件、且工具集被限制的辅助 agent。
_Avoid_: 用「子 agent」指代它；把它当作会话标签页里的普通会话

**子代理类型（Subagent type）**：
`spawn_subagent` 的 `subagent_type` 取值，决定子代理的工具集与系统提示词；现有取值为 `codebase_explorer`（只读探索与报告）与 `code_reviewer`（审查代码或 diff），两者工具集相同，都可只读使用 bash（`code_reviewer` 的系统提示词额外要求把结论绑定到证据）。
_Avoid_: 用「子代理」指代某个类型；把模型与推理强度算作类型的一部分（那是全局 subagent 配置）

**子代理任务（Subagent task）**：
一次 `spawn_subagent` 调用：从派发到终态的完整过程，对应子代理会话列表中的一项与 `subagent_tasks` 中的一行。
_Avoid_: 用它指代子代理会话本身

**子代理会话（Subagent session）**：
子代理实际运行的 pi 会话（`subagent_tasks.child_session_id`）；不出现在侧栏，只能从子代理会话列表打开。
_Avoid_: 与「子代理任务」混用

### 频道与消息

**频道（Channel）**：
一条配置好的消息收发连接：有 id、连接状态，绑定一个工作目录，并可维护一条持续的会话。
_Avoid_: 用「频道」指代定时任务的投递目标

**通知目标（Notification target）**：
挂在定时任务上、描述「把这次运行的结果发到哪里」的配置，由一个投递方式、一个收件人与一个具体频道组成。
_Avoid_: 通知通道（与频道近乎同义，等于没拆）；用裸的 channel 指代投递侧

**会话通知绑定（Session notify binding）**：
把某个会话的助手回复投递到某个频道的持久化绑定，按会话存于 `~/.pi-work/session-notify/<session-id>.json`。
_Avoid_: 与「通知目标」混用（那是定时任务的投递配置）；用裸的 channel 指代它

**频道工作目录（Channel cwd）**：
频道冷启动会话、运行 agent 时使用的绝对工作目录；频道绑定工作目录，不绑定侧栏的 Workspace 分组。
_Avoid_: 把频道的 workspaceId 当作 Workspace 分组

**入站消息（Inbound message）**：
频道收到、尚未交给 agent 的用户消息；`/new` 这类命令也算一种入站消息。
_Avoid_: 用「消息」单独指代它

**Inbox 消息（Inbox message）**：
Pi Work 后台任务与系统事件推入收件箱的一条记录。
_Avoid_: 把频道消息或通知内容当作 Inbox 消息

**频道冷启动（Cold start）**：
频道当前没有会话时，用一条入站消息新建会话并记住它。
_Avoid_: 用「新会话」指代它

**频道重置（Channel reset）**：
清掉频道的当前会话，使下一条入站消息重新冷启动。
_Avoid_: 把它当成删除会话

### 工具

**工具（Tool）**：
暴露给 pi agent 的单个可调用能力。
_Avoid_: 用「工具」指代一组工具

**工具集（Tool set）**：
一次会话、调度任务或看板任务实际选定的那组工具。
_Avoid_: 用「工具」指代工具集

**自定义工具（Custom Tool）**：
在 Pi Work 代码中实现、暴露给 pi agent 的工具。
_Avoid_: 把它当成历史遗留命名

**工具市场（Tool Market）**：
Pi Work 暴露给 pi agent 的全部工具的目录，是工具启用的唯一来源。
_Avoid_: 用 Custom tools 指代整个目录

**交互闸门（Interaction gate）**：
agent 的一步停下来等用户做一个决定的那个状态，有**权限确认**（一次危险命令，或一次代价高的建索引）与**提问**（一批结构化问题）两种形态；两种形态共用一张挂起表、一份重播契约与一份会话级备忘。被回答、被取消、超时或会话销毁都会让闸门作废。
_Avoid_: 用「队列」指代它（那是承载它的数据结构）；用「弹窗」指代它（那是它的渲染）；把它当作 pi 自身的工具权限机制

### 提示词与技能

**提示词（Prompt）**：
可编辑的 prompt 模板文件，只有 `~/.pi/agent/prompts/`（全局）与 `<cwd>/.pi/prompts`（项目）两处可编辑。
_Avoid_: 用它指代系统提示词

**追加系统提示词（Append System）**：
附加到系统提示词末尾的单文件 `~/.pi/agent/APPEND_SYSTEM.md`。
_Avoid_: 把它混同于 Prompt 模板

**斜杠命令（Slash command）**：
界面层对 Prompt 与 Skill 的统一调用入口，`source` 为 `"prompt"` 或 `"skill"`。
_Avoid_: 把它当成第三种资源

**技能（Skill）**：
一个 SKILL.md 目录。运行时会加载的来源有三处：`~/.pi/agent/skills/`（全局）、`<cwd>/.pi/skills/`（项目）、`~/.pi-work/skills/`（Pi Work 自有，pi 的 loader 不扫描）；仓库内 `agent-skills/` 只是平台维护的分发源，需用户自行拷贝到 `~/.pi-work/skills/` 后才会生效。
_Avoid_: 与 `.agents/skills/`（跨仓库共享技能）混用；把 `agent-skills/` 当作会被自动加载的目录

### 计划

**计划（Plan）**：
用户自己要在某个时间做的一件事，一条一个 Markdown 文件，位于数据根的 `user-plans/` 下（默认 `~/.pi-work/user-plans/`，与笔记的 `user-notes/` 同前缀）；与 agent 的会话、看板任务、定时任务都无关。
_Avoid_: 用「待办」「todo」指代它（那是已被刻意删除的旧功能）；把它当作笔记（笔记没有时间锚点与完成状态）

**时间锚点（Plan anchor）**：
计划「什么时候该出现在视野里」，只有三档：**日锚点**（某一天）、**周锚点**（某个日历周，周一–周日）、**月锚点**（某个月）。锚点只写在文件名里，是唯一真值。
_Avoid_: 把「日期」与「周期」当成两个字段；用「截止时间」概念指代它（计划没有截止时间）

**收件箱（Plans inbox）**：
还没有时间锚点的计划。给计划排期 = 把文件从 `inbox/` 移进对应月份目录并改名前缀。
_Avoid_: 与 Inbox 消息混用

**计划改名（Plan rename）**：
只改文件名里**标题那一半**，锚点前缀与所在目录原样不动，因此改名不可能改到日期；`created_at`、备注、完成状态随之保留。目标名已被占用是错误（`name-taken`），不会自动加 `-2`。
_Avoid_: 与「改期」混用（改期动的是锚点那一半）；把改名当成新建一条计划

**待整理（Unsorted plan）**：
文件名或 frontmatter 不符合约定的计划文件；面板只列出并指出问题，绝不自动改写。
_Avoid_: 把它当作草稿

**计划详情弹窗（Plan detail dialog）**：
点计划行打开的那个弹窗，备注的编辑与预览在同一处：够宽时左右分栏，窄时用弹窗内的「编辑 / 预览」切换。关闭即保存（Esc / 点遮罩 / ✕ / 换一条计划）。行上只留完成、重命名、改期、复制路径、删除，行内不再有备注编辑框，也没有单独的只读预览入口。
_Avoid_: 把它当作只读预览（预览只是它的一栏或一个 tab）；把它当作能改标题、能删除的地方（它只写备注）

**计划写入会话（Plan write session）**：
计划面板把内容写进文件的那台状态机：给它「现在的处境 + 你想干嘛」，它回「新的处境 + 接下来该做什么」。处境 = 打开的路径与它被读出来时的 mtime、备注草稿、脏不脏、保存状态、防抖是否已排、一次写是否在途、欠着的那次写、待决的那个冲突、是否正在新建；意图 = 打开 / 关闭弹窗、打字、立刻保存、防抖到点、勾完成、改期、改名、新建、计划被删、列表重读、五种写各自的结局、覆盖 / 重载 / 忽略。五种写（备注、完成、改期、改名、新建）共用同一套 mtime 守卫、409 分类、冲突挂起与解算和**一条**在途闩锁；删除不属于它（不带 mtime、不可能撞冲突，是普通 I/O）。它拥有草稿、mtime 守卫、在途闩锁、冲突与「关闭即保存」，不拥有列表数据、DOM 与 HTTP——那三层分别属于面板、面板的列表状态与接线层。对应代码中的 `lib/client/plan-write-session.ts`（纯 module + 一个可被依赖袋驱动的执行口）。
_Avoid_: 把它当作计划面板本身；把它与 `lib/shared/plans.ts` 混用（那是与服务端共用的领域规则：文件名语法、时间锚点、分区）
