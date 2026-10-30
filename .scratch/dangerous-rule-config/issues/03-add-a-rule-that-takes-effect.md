# 03: 写——新增一条规则，保存即生效

**What to build:** 用户在危险命令页点「新建」，填名字和正则，保存；规则出现在列表里，并且**立刻**在真实会话里生效——跑一条匹配的命令，确认弹窗弹出，弹窗上的规则名与刚建的那条对得上。不需要重启服务，也不需要新建会话。

这一刀要同时立起两块地基：一是共享的规则草稿与校验模块（本轮只含三个阻断项：名字为空、正则为空、正则编译失败），二是独立的写路由（读出磁盘配置、只替换这个配置项、写回；写盘前全量编译，坏正则返回 400 且磁盘不动）。写通路刻意不并入设置接口那套「客户端持整份配置、diff 出变更键」的机制：这一页要的是服务端算出来的生效集，形状对不上。

**Blocked by:** 01（看见——生效集接口 + 危险命令页 + 内置规则只读展示）

**Status:** done

- [x] 共享草稿/校验模块能由「磁盘上的用户规则 + 当前平台的内置集」算出可编辑草稿、唯一一个阻断项、以及要提交的请求体；纯函数，可直接单测
- [x] 阻断项至少覆盖：名字为空、正则 trim 后为空（并说明空正则匹配一切）、正则编译失败
- [x] 新增写路由：读-改-写整份配置，只替换该配置项；写盘前编译全部正则，任一失败即 400，磁盘保持原样
- [x] 页面能列出用户规则、能新建规则、能保存；保存控件复用已有的三态保存按钮
- [x] 保存后无需新会话即生效（依据：匹配在每次工具调用时读配置，编译结果按平台 + 规则内容做缓存键）
- [x] 页面文案全部进设置用的 i18n 字典，中文界面下无英文残留
- [x] 测试：纯模块覆盖三个阻断项；接口覆盖写入往返（写后读一致，测试结束恢复原状）与坏正则 400

## Comments

- 共享模块：`lib/shared/dangerous-commands-draft.ts`
  - `dangerousRulesDraft()`：磁盘用户规则 + 超时 → 可编辑草稿（`uid` 只服务于页面，不进配置）。
  - `dangerousRulesDraftProblem()`：唯一阻断项。判据按固定顺序跨整表扫描（名称空 → 正则 trim 后空 → 编译失败），
    不是逐行走；所以先修哪一行、报哪一条是可预测的。重名 / 撞内置名 / 超时越界归 05。
  - `dangerousRulesRequestBody()`：名字 trim（它是确认弹窗展示与会话「总是允许」的 key），正则原样保留
    （重写会悄悄改变匹配语义），`ignoreCase` 只在为 true 时携带。
  - `addDangerousRule()` / `isDangerousRulesDraftDirty()` / `validateDangerousRulesWrite()`：编辑器结果入草稿、
    dirty 判定、以及写路由的同一套校验入口。
- 写路由：`PUT /api/dangerous-commands`（`app/api/dangerous-commands/route.ts`）只做形状校验 + 日志；
  读-改-写落在 `writeDangerousRules()`（`lib/server/dangerous-patterns.ts`），只替换 `dangerous_patterns`，
  其余配置原样带回。写盘前用共享模块编译全部正则，任一失败即 400 且不调用 `writeConfig()`（磁盘不动）。
  请求不带 `timeoutMs` 时保留磁盘值，规则保存不会顺手重置超时。
- 页面：危险命令页顶部新增「你的规则」列表 + 右上「新建规则」；新建用独立弹层编辑器
  （`components/settings/dangerous-commands/DangerousRuleEditor.tsx`，与子代理编辑器同形），
  行内标红该阻断项并附上正则引擎给的原因；页尾复用三态 `SaveButton` + `UnsavedHint`。
  空列表显示「还没有自定义规则。下面的内置规则仍然生效。」内置规则与「试一条命令」两块保持 01/02 的行为。
- 生效时机：保存走 `writeConfig()` → `readConfig()` 按 mtime/size 失效，下一次工具调用的
  `matchDangerousPattern()` 立刻读到新规则（编译缓存按平台 + 规则内容做 key）。接口测试直接用
  「PUT 后 POST /test 命中刚写的用户规则」钉住这条，不涉及新建会话。
- 未保存登记：按 ADR-0019 把 `dangerous-commands` 加进 `StagedSettingsKey` 并上报 dirty，
  切页 / 关窗走既有确认框（06 仍负责这一页的提醒验收与人工 smoke）。
- i18n：新增文案全部进 `lib/shared/i18n-dict/settings.ts`；正则引擎的编译原因作为技术细节用等宽小字展示
  （是数据，不是文案）。
- 测试：`tests/unit/dangerous-commands-draft.test.ts`（草稿、三个阻断项及其固定顺序、提交体、dirty、
  写入口校验，24 例）；`tests/unit/dangerous-commands-api.test.ts` 新增 PUT 往返、清空用户规则、
  保存后立即命中、坏正则 400 且磁盘不变、空名 / 空正则 400、形状 400。
  全量 `pnpm test` 108 文件 / 1345 用例通过；`tsc --noEmit` 与 eslint 干净。
- 代码审查后收敛：写通路的读-改-写从路由移到 server 模块；阻断项文案映射归到 `lib/client`（照
  `models-config-problem-text` 的先例）；阻断项判定不再需要占位 `timeoutMs`；补上未保存登记；
  去掉编辑器里只有客户端知道的 `maxLength`。
- 已知取舍：磁盘上已有手改坏正则时，整表不可保存（页面会标红并说明原因），要等 04 的编辑/删除
  或手工修 YAML；「保存失败」保持草稿不丢，不额外做乐观更新（与 `/api/append-system` 同一形态）。
- 人工 smoke（未做，交给完整功能后统一过）：新建规则 → 保存 → 真实会话跑匹配命令 → 确认弹窗规则名对得上；
  把正则改坏 → 保存被拒并标红；清空用户规则 → 出现「内置仍在生效」；未保存改动切页 / 关窗 → 提醒出现。
- 未做：04（编辑 / 删除 / 上移下移）、05（重名 / 撞内置名 / 超时越界）、06（人工 smoke 与提醒验收）。
