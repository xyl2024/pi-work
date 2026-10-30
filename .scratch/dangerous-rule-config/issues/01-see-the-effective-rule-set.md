# 01: 看见——生效集接口 + 危险命令页 + 内置规则只读展示

**What to build:** 用户打开设置弹窗，Agent 分组里多出一页「危险命令」，页面上列出**当前平台真正生效**的那套内置危险命令规则（bash 那套 everywhere，PowerShell 那套只在 Windows），并明确写着「上面的自定义规则清空也不会关掉这些」。这一页读得到的内置集，就是闸门真实在用的那份——不是另一份抄本。

同时，服务端要能回答一个此前回答不了的问题：一条命令命中的是**用户的规则**还是**内置规则**。今天的匹配只回一个规则名，页面要标来源，所以生效集的组装必须保留出处。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 新增的读接口返回当前平台的 `platform`、内置规则集（名字 / 正则 / 是否忽略大小写）、以及用户规则里编译失败的那几条
- [x] Windows 上内置集含 PowerShell 那套，Linux / macOS 上不含
- [x] 设置注册表里新增分区，归 Agent 分组，标签文案为「Dangerous commands」/「危险命令」；注册表一致性测试与类型检查通过
- [x] 页面把内置规则列为只读清单，并显示「清空自定义规则不会关掉这些」的说明
- [x] 生效集组装能对一次命中给出规则来源（用户 / 内置），并保持「用户规则在前、内置在后、首个命中者胜」的既有语义
- [x] 生效集里如果存在编译失败的用户规则，接口把它们带出来（供后续页面标红），不在服务端静默丢弃

## Comments

- 读接口：`GET /api/dangerous-commands`（`app/api/dangerous-commands/route.ts`）→
  `getEffectiveDangerousRuleSet()`，返回 `{ platform, builtins, invalidUserRules }`；用户规则与
  `timeout_ms` 仍随 `GET /api/settings` 下发，不重复一份。
- 单一生效集：`lib/shared/dangerous-commands.ts` 的 `assembleDangerousRules()` 同时产出
  带来源的 `rules`、供匹配的 `compiled` 与 `invalidUserRules`；闸门
  （`lib/server/dangerous-patterns.ts`）和页面快照（`buildDangerousRuleSetSnapshot`）都读它，
  页面列出的内置集就是闸门在用的那一层，不是另一份抄本。顺序/首个命中语义未变。
- 页面：设置弹窗 Agent 分组新增 `dangerous-commands`（`components/settings/sections/DangerousCommandsSection.tsx`），
  只读列出当前平台内置规则，写明「这些规则始终生效、无法关闭」「清空自定义规则不会关掉它们」
  「命中只是确认，不是拦截」；自保护按 ADR-0020 不出现在页面。
- 测试：`tests/unit/dangerous-commands.test.ts` 覆盖来源标记、用户在前/内置在后、平台分叉；
  `dangerous-commands-route.test.ts` 用临时数据根写入坏正则，验证路由把编译失败的用户规则带出来；
  `dangerous-commands-api.test.ts` 走真实 HTTP 验证平台与内置集。全量 `pnpm test` 105 文件 / 1304 用例通过。
- 代码审查（Standards + Spec 两轴）后收敛：合并两套组装、去掉重复的 `resolveDangerousRules` 逻辑、
  页面不再提前实现 03/04 的用户规则列表与标红、文案改为「当前平台」。
- 未做：02–06（试一条命令、写路由、编辑排序、名字/超时约束、未保存提醒）。
