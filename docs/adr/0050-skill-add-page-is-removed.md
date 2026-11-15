# 技能的新增页被删除，技能面板只剩浏览

技能主视图（ADR-0014 修订后的形态）里那个「搜索 skills.sh 并安装」的表单页整体下线：添加按钮、表单页、`/api/skills/search`、`/api/skills/install`、`npx skills add` 的服务端持有、安装进度状态与角标、以及「安装进行中」的关标签确认守卫，全部随实现一起删除。

**我们决定**技能管理只保留浏览：按来源分组的列表、搜索词过滤、详情页（SKILL.md 正文与附属文件）、模型调用开关。想装新技能，用户自己在仓库/全局技能目录里放 `SKILL.md`，或直接用 pi CLI 的技能命令。

理由：

- 安装依赖外部 skills.sh 生态与 `npx skills add`，网络失败、上游格式变化、超时兜底都由本仓库养着，是一条持续付费的链路，而使用反馈里这条链路并不是高频路径。
- 安装是唯一一个让技能面板需要「进行中状态 + 角标 + 离开确认」的功能；删掉它之后，技能回到 ADR-0014 最想要的那个纯「即时生效项」形态：没有 dirty、没有守卫、没有模块级后台任务，`skills-panel.ts` 缩回一个普通的浏览 store。
- 留着 UI 但砍服务端、或砍 UI 但留 API，都只会留下半条死链路；整条删干净才不会让下一个改这块的人对着幽灵接口猜语义。

**Consequences**：

- `lib/shared/skills.ts` 里的搜索/安装类型、`SkillsPage` 的 form 页、`lib/client/skills-io.ts` 的 `searchSkills`/`installSkill`、`lib/shared/skills-close.ts`、`lib/server/npx.ts`、`lib/server/skills-describe.ts` 一并删除；i18n 词条只留浏览态仍在用的。
- 右栏/主视图角标钩子少了一个使用者（技能），模型配置与频道不受影响。
- 聊天输入框的 `/skill:...` 选择菜单与 SKILL.md chip 不动——「这次用哪个技能」与「管理技能」仍是两件事（ADR-0014 的原话）。
