# 02: 验证——试一条命令的三档结果

**What to build:** 用户在危险命令页上输入一条命令，立刻知道它会不会触发确认、会被谁拦。结果分三档且带来源：不可配置的硬拦截（自保护）／命中了某条规则（标明是「你的规则」还是「内置规则」）／不命中。

判定走服务端，因为自保护那一档要知道本进程的 pid 与监听端口，客户端算不出来；也因为测试框与真实拦截必须踩同一条代码路径，否则「试出来没事、真跑却被拦」这种反直觉迟早出现。

输入框放在**页级**，不在规则编辑器里——用户问的是「我这条命令会不会被拦」，答案取决于整份生效集。

**Blocked by:** 01（看见——生效集接口 + 危险命令页 + 内置规则只读展示）

**Status:** done

- [x] 新增的判定接口接受一条命令，返回三档结果之一
- [x] 命中结果带规则名与来源（用户 / 内置）
- [x] 自保护与普通规则同时成立时，结果是硬拦截，并带上自保护的理由
- [x] 命令为空时页面不发请求，直接显示「不命中」
- [x] 四类结果各有一条接口测试：硬拦截、用户规则命中、内置规则命中、不命中
- [x] 页面结果区分「会弹确认」与「直接被硬拦」，不让两者看起来像同一件事

## Comments

- 判定入口：`POST /api/dangerous-commands/test`（`app/api/dangerous-commands/test/route.ts`）→
  `evaluateDangerousCommand(command)`（`lib/server/dangerous-patterns.ts`）。空命令由路由直接答
  `{ kind: "none" }`；非字符串 `command` 返回 400。
- 只有一条判定路径：`evaluateDangerousCommand` 先跑自保护（`matchSelfKillCommand`），再跑规则匹配，
  `tool_call` 闸门（`lib/server/rpc-manager.ts`）与试命令框都调它。原来那个「闸门里先自保护后匹配」
  的源码守卫测试改成钉这个顺序在 `dangerous-patterns.ts` 里，并新增一条「闸门走
  `evaluateDangerousCommand`」的守卫。
- 契约偏差（相对 spec 里的 `matched.selfProtectionReason?`）：自保护先判且必胜，两个同时成立时
  返回的 `kind` 就是 `self_protected`（自带 `reason`），`matched` 永远拿不到这个字段。为了让契约
  不留下一个永远为空的字段，`DangerousCommandVerdict` 的 `matched` 只有 `ruleName` + `source`；
  「测试结果与真实行为不分叉」由「同一条判定路径 + 自保护优先」保证，而不是靠一个多余字段。
- 页面：`components/settings/sections/DangerousCommandsSection.tsx` 底部新增「试一条命令」，输入框 +
  测试按钮（回车同效），空输入不出请求。三档用不同形态：硬拦截红框 + 说明「这一页改不了」+ 服务端给
  的理由；命中为普通卡片 + 规则名等宽 + 「你的规则 / 内置规则」标签 + 「会等你选择，不是拦截」；
  不命中为一句灰字。请求带序号，晚到的旧响应不会覆盖新结果。
- i18n：新增词条都在 `lib/shared/i18n-dict/settings.ts`。
- 测试：`tests/unit/dangerous-commands-test-route.test.ts` 走路由 + 临时数据根，覆盖硬拦截、用户规则
  命中（`source: "user"`）、内置规则命中（`source: "builtin"`）、不命中、自保护压过同串用户规则、
  空命令、非字符串 400；`tests/unit/dangerous-commands-api.test.ts` 用真实 HTTP 验证硬拦截与不命中。
  全量 `pnpm test` 107 文件 / 1337 用例通过；`tsc --noEmit` 与 eslint 干净。
- 人工 smoke（未做，交给完整功能后统一过）：本页输入 `pkill node` 应落在「硬拦截」而非「不命中」。
- 未做：03–06（写路由与保存、编辑排序、名字/超时约束、未保存提醒）。
