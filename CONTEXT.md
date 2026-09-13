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

### 会话

**会话（Session）**：
pi 的一次持久化对话单元，对应一个 JSONL 会话文件、界面中的一个标签页，以及进程内的 `AgentSessionWrapper`。
_Avoid_: conversation、对话、chat

**对话（Conversation）**：
会话内部由消息与分支组成的对话历史；对话树（Conversation Tree）是它的一种视图。
_Avoid_: 用 conversation 指代整个会话

**上下文窗口（Context Window）**：
会话当前送入模型的上下文内容与容量；压缩（compact）是对它的操作。
_Avoid_: context、Context 面板、React Context

**BTW（By the way）**：
与当前会话上下文绑定、只读且不写入主会话的侧边临时对话，只持久化在浏览器 localStorage 中。
_Avoid_: 把它当作会话、分支或子 agent

**收藏（Favorite）**：
用户标记的会话，保存在 `favorites.json` 的 sessionIds 中。
_Avoid_: 用它指代工作目录

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
