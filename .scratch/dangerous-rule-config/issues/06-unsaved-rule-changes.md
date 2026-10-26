# 06: 提醒——未保存的规则改动

**What to build:** 用户改了一条规则没保存就切到别的设置页，或直接关掉设置弹窗，会被问一句「要丢弃未保存的改动吗」——和改动还没保存的个人资料页、网络代理页用同一套形态、同一句话。丢弃并离开后，关窗时不再为一份已经不存在的改动问第二次。

规则列表是自由文本，按设置页的既有划分属于**待保存项**，所以它必须进入弹窗的未保存改动登记，否则切页与关窗都会安静地丢掉草稿。

**Blocked by:** 03（写——新增一条规则，保存即生效）

**Status:** done

- [x] 危险命令页纳入设置弹窗的未保存改动登记
- [x] 有未保存改动时切到另一页会先确认；点当前页不算切换，不询问
- [x] 有未保存改动时关闭弹窗会先确认，文案与其它待保存项页面完全相同
- [x] 确认丢弃后切页，再关窗不会二次询问
- [x] 无未保存改动时，切页与关窗都不打扰

## Comments

- 登记本身在 01 / 03 就已经接上了：`dangerous-commands` 在 `StagedSettingsKey`（`components/settings/use-unsaved-changes.ts`）里、
  `components/settings/pages.tsx` 把 `reportDirty` 传给该页、`DangerousCommandsSection` 用
  `isDangerousRulesDraftDirty`（规则表 + 超时）上报 dirty，关窗与切页共用
  `UNSAVED_CHANGES_CONFIRM_KEY` 与同一个 `window.confirm`。本轮验收时发现真正缺的是**判定方向**。
- 判定方向反了：`selectSectionLeave` 原来问的是**目标页**（"切到的那一页还脏吗"）。一页切走即卸载、
  草稿随之丢弃，所以离开脏页时什么都不问、草稿静默没了，回来时又为一份已经不存在的改动弹一次
  「要丢弃未保存的改动吗」。现在改成问**被离开的那一页**（`from`）：`from !== to` 且 `from` 脏时返回
  `{ kind: "confirm", key: from }`，确认后清掉的正是刚被卸载的那一页，关窗因此不会二次追问。
  点当前已打开的分区仍永不确认（`from === to` 直接放行）。
- 这是对 ADR-0019 原口径的取代，不是悄悄改语义：`docs/adr/0019-settings-sections-are-pages.md` 追加了
  「修订 2026-10-26」，点名被取代的正文段落与 Consequences 条目，并更新待保存页清单为四页
  （个人资料 / 追加系统提示词 / 网络代理 / 危险命令）；`CONTEXT.md` 的「未保存改动」词条改成
  「离开一个有未保存改动的分区前是否确认」，旧 spec 的 issue 02 里那句「若要改成离开脏页确认，
  需要先改 spec」加注指向该修订。
- 影响面刻意保持全局：三个更早的待保存页（个人资料、追加系统提示词、网络代理）也一起改问离开的那一页。
  只给危险命令页特判会造出第二套「未保存」语义，而这正是 ADR-0019 明确不要的东西。
- 测试（纯模块缝，ADR-0003）：`tests/unit/settings-unsaved.test.ts` 的 `selectSectionLeave` 一组改成离开语义——
  离开脏页要确认并指出该页、离开干净页不因别页脏而追问、点当前页不问、多页同时脏时只拦被离开的那一页、
  清掉该 key 不影响其它 key、确认丢弃后 `selectCloseConfirmKey` 变 null。测试里的 section id 收紧到
  `SettingsSectionId`，`reduce` 改成按键类型泛型，所以把 `"dangerous-command"` 写错会编译失败。
- 验证：`tsc --noEmit`、改动文件 ESLint、`pnpm test`（108 文件 / 1370 用例）通过。
- 代码审查（Standards + Spec 两轴）后收敛：补上 ADR 里被取代的 Consequences 条目、`CONTEXT.md` 词条、
  旧 issue 02 的语义注记；修正修订段里一处不准确的因果（旧口径下「确认后关窗不再问」本来就成立，
  真正的缺陷是确认时草稿已经没了）；测试去掉重复的 confirm/discard 形状并给 section id 加上类型。
- 未做 UI 人工 smoke（按仓库约定不擅自起服务），留给整页 smoke 一起过：改一条规则不保存 → 切到别的
  设置页／关窗都会问；点当前页不问；确认丢弃后关窗不再问；干净时切页与关窗都不打扰。
