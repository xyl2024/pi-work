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

**上下文窗口（Context Window）**：
会话当前送入模型的上下文内容与容量；压缩（compact）是对它的操作。
_Avoid_: context、Context 面板视图、React Context

**BTW（By the way）**：
与当前会话上下文绑定、只读且不写入主会话的侧边临时对话，只持久化在浏览器 localStorage 中。
_Avoid_: 把它当作会话、分支或子 agent

**收藏（Favorite）**：
用户标记的会话，保存在 `favorites.json` 的 sessionIds 中。
_Avoid_: 用它指代工作目录

### 频道与消息

**频道（Channel）**：
一条配置好的消息收发连接：有 id、连接状态，绑定一个工作目录，并可维护一条持续的会话。
_Avoid_: 用「频道」指代定时任务的投递目标

**通知目标（Notification target）**：
挂在定时任务上、描述「把这次运行的结果发到哪里」的配置，由一个投递方式、一个收件人与一个具体频道组成。
_Avoid_: 通知通道（与频道近乎同义，等于没拆）；用裸的 channel 指代投递侧

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
