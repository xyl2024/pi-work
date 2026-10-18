# Pi Work

pi coding agent 的 Web UI：会话浏览与实时对话、工作目录下的文件操作，以及一组辅助面板。

## Language

### 工作区

**工作目录（cwd）**：
定位一个会话及其文件操作的绝对目录路径。
_Avoid_: space、project、项目——代码、类型、日志与文档里只准用这个叫法；**面向用户的界面文案是唯一例外**，那里一律叫「项目」（`lib/shared/i18n-dict/` 里的 `project`、「此项目」、「N 个项目」指的都是 cwd，不是工作目录分组）

**工作目录分组（Workspace）**：
侧栏中按 cwd 聚合的一组会话，是 `/api/workspaces` 返回的单元。
_Avoid_: 用 Workspace 指代磁盘路径

### 运行环境与信任

**信任边界（Trust boundary）**：
决定「谁可以访问这个进程、谁签发会话」的那一处规则，对应代码中的 `lib/shared/trust-boundary.ts`（纯 module）。两条轨道共用同一套 cookie、路由与客户端调用，只有签发方不同：**服务器轨道**（默认）的会话密钥来自 `PI_WORK_AUTH_*`，登录页可用；**桌面轨道**（`PI_WORK_DESKTOP`）由外壳每次启动生成的随机值（`PI_WORK_DESKTOP_SECRET`）签发并注入 cookie，登录页关闭、服务只绑 loopback。
_Avoid_: 把它当作登录页（那只是服务器轨道签发信任的一个入口）；用「鉴权」泛指它（那只是 401 与登录那一层）

**桌面轨道（Desktop track）**：
Pi Work 由 Electron 外壳拥有并拉起的那条运行方式（`PI_WORK_DESKTOP`）：服务端原生跑在 Windows 上、只监听 loopback、信任凭据每次启动随机生成、没有登录页。外壳用自己捆绑的独立 Node 运行时跑生产服务端（不是 Electron 自带的 Node，原生模块不必按 Electron ABI 重编译），端口每次启动随机，退出时结束整个进程树；窗口与应用寿命是两件事——关窗只把窗口藏进托盘，服务端与它里面的后台循环（定时任务、频道）继续跑，只有托盘「退出」才结束进程树。决策在 `electron-shell/server-process.js` 与 `electron-shell/lifecycle.js`。它与**服务器轨道**（用户自己部署的 Linux 服务器，保留登录页与 `PI_WORK_AUTH_*`）共用同一份代码。
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
面板标签页所承载的单个工具界面，如翻译、Token 审计、模型配置。
_Avoid_: 用「面板」指代它

**模型配置（Models config）**：
右侧面板里的一个面板视图，用来编辑用户 `~/.pi/agent/models.json`：有哪些 provider、各自怎么接（Base URL、API Key、OAuth），以及每个 provider 下的模型条目。
_Avoid_: 与「会话内选当前模型」混用（那是「这个会话用哪个模型」，这是磁盘上有哪些 provider / 模型）；用「Models」指代它

**模型目录（Model catalog）**：
Pi Work 掌握的全部可用模型数据，即 pi runtime 探测到的模型清单；在模型配置面板视图里既能只读浏览，也被添加 / 填充模型的表单用来按关键词检索。
_Avoid_: 把它当作独立的面板视图或右侧按钮；用它指代已经配置好的 provider / 模型

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

### 设置

**设置分组（Settings group）**：
设置弹窗主体里的视觉分组标题，把若干设置分区归到一起；不可点击、不参与导航。
_Avoid_: 用「分区」指代它；把它当作可折叠的区域

**设置分区（Settings section）**：
设置弹窗中侧栏导航与滚动定位的单元，对应一个分组下的一个主题（个人、外观、Agent retry…）。
_Avoid_: 用「分组」指代它；把它当作标签页

**设置项（Setting）**：
一个可改的配置值，住在某个设置分区里；它的输入形态决定它属于即时生效项还是待保存项。
_Avoid_: 用「配置项」「选项」指代它

**即时生效项（Immediate setting）**：
改动当场落盘的设置项，含开关、枚举、单选、复选与失焦提交的数值；没有保存按钮。
_Avoid_: 把它当作「自动保存」（那是同一个动作的另一种说法）

**待保存项（Staged setting）**：
改动先停在本地、需要显式保存的设置项，即自由文本与密钥。
_Avoid_: 把它当作草稿

**未保存改动（Unsaved change）**：
待保存项相对其已落盘值的差异；设置弹窗用它决定关闭前是否确认。
_Avoid_: 草稿（已用于会话标签页）

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
_Avoid_: 把它当作「对话时间线」（那是可见性与索引投影）；把它当作一个可以逐条点开的统计面板

**消息内容（Message content）**：
从一条消息里抽取展示所需的内容事实：文本、图片数量、内容块数量与字符数。对应代码中的 `lib/shared/message-content.ts`（纯 module）。
_Avoid_: 与「工具调用展示」混用；用「消息」泛指它

**会话内搜索（In-session search）**：
在单个会话的对话里按关键字查找消息、并跳转到命中所在分支的入口（Ctrl+F）。
_Avoid_: 与会话库、会话列表的搜索混用

**回放（Replay）**：
会话已停止时按索引顺序重看这段对话历史的只读模式。
_Avoid_: 把它当作分支导航或压缩

**自动起名（Auto-naming）**：
会话在第一条助手回复落地后自动生成并写入名字；也可由用户手动触发，覆盖已有名字前需确认。
_Avoid_: 与「重命名」混用（那是用户直接改名）；把它当作会话标题的来源

**收藏（Favorite）**：
用户标记的会话，保存在 `favorites.json` 的 sessionIds 中。
_Avoid_: 用它指代工作目录

**今日会话（Today's sessions）**：
侧栏里把「最后活动时间落在本地当日」的会话扁平列出的一个视图，与「会话」区的 cwd 分组重复呈现。
_Avoid_: 把它当作新实体、新分组或「今天创建」的会话（口径是最后活动时间，不是创建时间）

### 子代理

**子代理（Subagent）**：
由某个会话通过 `spawn_subagent` 工具启动、拥有自己的 pi 会话文件、且工具集独立配置的辅助 agent。
_Avoid_: 用「子 agent」指代它；把它当作会话标签页里的普通会话

**子代理档案（Subagent profile）**：
一条用户可编辑的子代理定义，存于 `subagents.db` 的 `subagent_profiles` 表：名称（`spawn_subagent` 的 `subagent_name` 取值）、描述、系统提示词、工具集、模型与推理强度、Pi Bot 形象与运行超时。两个内置档案 `codebase_explorer`（只读探索与报告）与 `code_reviewer`（审查代码或 diff）在首次初始化时写入表中，之后同样可改可删。
_Avoid_: 把「子代理档案」说成「子代理类型」；把它与某次调用（子代理任务）混为一谈

**子代理任务（Subagent task）**：
一次 `spawn_subagent` 调用：从派发到终态的完整过程，对应子代理会话列表中的一项与 `subagent_tasks` 中的一行。
_Avoid_: 用它指代子代理会话本身

**子代理会话（Subagent session）**：
子代理实际运行的 pi 会话（`subagent_tasks.child_session_id`）；不出现在侧栏，只能从子代理会话列表打开。
_Avoid_: 与「子代理任务」混用

### 频道与消息

**频道（Channel）**：
一条配置好的 IM 账号绑定：有 id、连接状态，绑定一个微信账号、一个工作目录与一条同步游标，并可维护一条持续的会话。它在界面上是一个**面板视图**（右侧按钮列上的全局按钮，列表与选中会话的 cwd 无关；管理入口只有右栏按钮与命令面板两条，面板内是「根页（新建 + 列表）→ 详情页（状态 / 重命名 / 启停 / workspace / 扫码登录 / 健康 / 活动流）」两级页栈）。
_Avoid_: 用「频道」指代定时任务的投递目标（那是「通知目标」里同名的字段，与账号绑定不是一回事）；把聊天输入栏的「通知频道」子菜单、新会话页的通知频道选择器或「会话通知绑定」当成频道管理

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

**频道冷启动（Cold start）**：
频道当前没有会话时，用一条入站消息新建会话并记住它。
_Avoid_: 用「新会话」指代它

**频道重置（Channel reset）**：
清掉频道的当前会话，使下一条入站消息重新冷启动。
_Avoid_: 把它当成删除会话

### 定时任务

**定时任务（Scheduled task）**：
一条在指定 cron 表达式与工作目录上、由服务端后台调度循环到点触发的任务。它在界面上是一个**面板视图**（右侧按钮列上的全局按钮；任务列表是全局数据，只有新建表单的工作目录默认值跟选中会话走）；启停是**即时生效项**，任务表单是**待保存项**。
_Avoid_: 用「计划」「定时器」「调度」指代它；把它和「运行记录」混用

**运行记录（Task run）**：
定时任务一次执行的记录（状态、回复正文、错误、耗时、会话 id），由服务端在每次触发时写入，有运行中记录时面板每 2 秒重拉。它属于任务，不属于会话。
_Avoid_: 与「定时任务」混用；把它当成会话的一部分（任务不绑定会话，只有每次运行写一个会话 id 供跳转）

### 工具

**工具（Tool）**：
暴露给 pi agent 的单个可调用能力。
_Avoid_: 用「工具」指代一组工具

**工具集（Tool set）**：
一次会话或调度任务实际选定的那组工具。
_Avoid_: 用「工具」指代工具集

**自定义工具（Custom Tool）**：
在 Pi Work 代码中实现、暴露给 pi agent 的工具。
_Avoid_: 把它当成历史遗留命名

**交互闸门（Interaction gate）**：
agent 的一步停下来等用户做一个决定的那个状态，有**权限确认**（一次危险命令，或一次代价高的建索引）与**提问**（一批结构化问题）两种形态；两种形态共用一张挂起表、一份重播契约与一份会话级备忘。被回答、被取消、超时或会话销毁都会让闸门作废。
_Avoid_: 用「队列」指代它（那是承载它的数据结构）；用「弹窗」指代它（那是它的渲染）；把它当作 pi 自身的工具权限机制

### 提示词与技能

**追加系统提示词（Append System）**：
附加到系统提示词末尾的单文件 `~/.pi/agent/APPEND_SYSTEM.md`。
_Avoid_: 用它指代系统提示词本身

**斜杠命令（Slash command）**：
聊天输入框里 `/` 唤起的统一调用入口，`source` 为 `"skill"` 或 `"action"`（Pi Work 内置的 `/new`、`/compact`、`/model`）。Pi Work 不展示也不管理 pi 的 prompt 模板文件（`~/.pi/agent/prompts/`、`<cwd>/.pi/prompts`），直接输入 `/name` 仍由 pi 自身展开。
_Avoid_: 把它当成第三种资源

**技能（Skill）**：
一个 SKILL.md 目录。运行时会加载的来源有三处：`~/.pi/agent/skills/`（全局）、`<cwd>/.pi/skills/`（项目）、`~/.pi-work/skills/`（Pi Work 自有，pi 的 loader 不扫描）；仓库内 `agent-skills/` 只是平台维护的分发源，需用户自行拷贝到 `~/.pi-work/skills/` 后才会生效。它在界面上是一个**面板视图**（右侧按钮列上的全局按钮，内容跟选中会话的 cwd 走），启用状态按工作目录分桶，是 Pi Work 对来源的覆盖项。
_Avoid_: 与 `.agents/skills/`（跨仓库共享技能）混用；把 `agent-skills/` 当作会被自动加载的目录；与聊天里「这次用哪个技能」的入口（输入框 `/skill:...` 菜单、SKILL.md 文件 chip）混用

**技能安装（Skill install）**：
从 skills.sh 搜索技能、经 `npx skills add` 落盘到全局或当前项目的过程；由技能面板的添加页发起，日志流式回显。
_Avoid_: 与手工把 `agent-skills/` 拷进 `~/.pi-work/skills/` 混用（那不是这条安装流程）；用「添加技能」指代它（那是面板里的按钮/页面，不是过程）

### MCP

**MCP 服务器（MCP server）**：
pi 的 MCP 扩展在一个会话启动时连接的外部工具来源，配置写在 pi 自己的 `mcp.json` 里而不是 Pi Work 的 `config.yaml`，工具以 `mcp__<服务器>__<工具>` 注册。它在界面上是一个**面板视图**（右侧按钮列上的按钮，内容跟选中会话的 cwd 走），面板内的改动是**待保存项**，一次保存整批写回。
_Avoid_: 把它当作 Pi Work 的集成（Pi Work 只读写它的配置文件，连接与工具注册都在 pi 那边）

**服务器条目（Server entry）**：
`mcpServers` 里的一项，由名字加一份配置组成：stdio（`command`/`args`/`env`/`cwd`）或 streamable HTTP（`url`/`headers`）。
_Avoid_: 用「服务器」指代整份 `mcp.json`

**条目作用域（Entry scope）**：
条目来自哪份文件：**全局**（`~/.pi/agent/mcp.json`，总是读）与**本工作目录**（`<cwd>/.pi/mcp.json`，只在 `PiWorkConfig.mcp.project_servers` 打开时读）；pi 自己的字段名仍是 `project`。
_Avoid_: 用「项目」指代它（那是 cwd 的 _Avoid_ 词，且「工作目录分组（Workspace）」已指侧栏的会话分组）；把它当成每个会话各存一份

**条目覆盖（Entry shadowing）**：
两份文件里的同名条目按作用域合并，**本工作目录**的那份替换全局的那份；两份都留在文件里，只有被替换掉的那份不会被连接。
_Avoid_: 把它当作条目被移动或删除

**无效条目（Invalid entry）**：
解析通过但没通过 pi 校验的条目，pi 只跳过它、其余服务器照常连接；所以它既不等于整份文件坏掉，也不允许被静默丢弃或重写。
_Avoid_: 把它当作 `mcp.json` 解析失败（那是文件级错误，面板拒绝保存）

**工具暴露级别（Exposure）**：
一个 MCP 服务器的工具对模型可见的程度，五档：`codemode`、`codemode-deferred`、`deferred`、`direct`、`hidden`，可用 `toolExposure` 按工具覆盖。
_Avoid_: 与会话工具集（loadout）混用
