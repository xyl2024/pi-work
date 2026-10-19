# 02: 未保存改动守门：导航圆点 + 切页拦截

**What to build:** 带待保存项的分区（目前是个人资料、Append System Prompt、网络代理）在左侧导航里挂一个小圆点，用户一眼能看出哪里还有没落盘的改动。点开一个有未保存改动的分区时，先弹一句「Discard unsaved changes?」（与关窗时同一句文案、同一个 `window.confirm`，不为切页另造 Save / Discard / Cancel 内联条）：确认则丢弃改动并跳转，取消则留在原页。

丢弃跳转时必须把该页从「未保存改动」集合里显式清掉，否则关窗时会二次确认一个已经不存在的改动。点当前已经打开的分区永不弹确认，即使它有未保存改动 —— 那不是一次导航。没有任何未保存改动时切页不受任何打扰。

待保存项上报的 key 从裸字符串收紧成从设置分区 id 派生的联合，让「哪些页可能有未保存改动」由类型列出；新增待保存页却漏接上报时希望编译器能说话。Append System Prompt 里内联写死的上报 prop 类型换成仓库已有的上报类型。「能不能离开这一页」下沉为一个纯选择器：给定脏 key 集合与目标分区，返回「可以走」或「先确认、脏的是哪个 key」。清理单个 key 复用注册模块已有的「不再脏」action，不新增 action。

**Blocked by:** 01

**Status:** done

- [x] 有未保存改动的分区在导航里带小圆点，圆点颜色用主题 warning 色；没有未保存改动的分区不带。
- [x] 点有未保存改动的分区 → 出现确认提示；确认后跳到该页，原页的未保存改动被丢弃。
- [x] 确认丢弃并跳转后，关闭设置弹窗**不再**弹「Discard unsaved changes?」。
- [x] 在确认提示里取消 → 留在原页，导航选中态、圆点、输入框内容都不变。
- [x] 点当前已打开的分区不弹任何确认（包括该页有未保存改动时）。
- [x] 两个分区同时有未保存改动时，点其中一个只针对被点的那页确认，另一页的改动不受影响。
- [x] 没有未保存改动时切页不出现任何提示。
- [x] 待保存项上报的 key 类型不再是 `string`；提交一个不在联合里的 key 会让 `tsc --noEmit` 报错。
- [x] 「能否离开这一页」判定与「清掉单个 key」都是纯函数，有单测覆盖：无脏、目标即当前页、他页脏、多页同时脏、清一个 key 不影响其它 key。
- [x] 未保存改动的确认只有一种形态：关窗与切页都用同一个 `window.confirm` 与同一句文案。

## Comments

- 2026-10-20: 已实现并提交。`onDirtyChange` 上报的 key 收紧为 `StagedSettingsKey`（`SettingsSectionId` 的三个待保存分区），`DirtyReporter` 成为唯一入口，报一个不在联合里的 key 会 `tsc --noEmit` 报错；`lib/shared/settings-unsaved.ts` 的 reducer 改为按键类型泛型（弹窗以 `SettingsSectionId` 为键），新增纯选择器 `selectIsDirty`（导航圆点）与 `selectSectionLeave`（当前页 → 目标页），清理单个 key 复用既有 `saved` action。切页确认与关窗确认共用同一个 `window.confirm` 与 `UNSAVED_CHANGES_CONFIRM_KEY`。
- 验证：`tsc --noEmit`、改动文件 ESLint、`pnpm test`（90 files / 1161 tests）通过。仓库级 `pnpm run lint` 因既有 `volumes/pi_home/.pi` 权限（EACCES）失败，与本次改动无关。未启动 UI 做手动 smoke。
- 语义说明（评审提出）：判定只针对**被点开**的那一页，与 spec「给定脏 key 集合 + 目标分区」一致；因此从一个脏页切到干净页不弹确认，该页草稿随卸载丢弃（issue 04 的「切走即丢弃」既定语义），而脏标记仍留在注册表里。若要改为「离开脏页也要确认」，需要先改 spec（会与「多页同时脏只拦被点的那页 / 另一页改动不受影响」两条冲突）。
- 评审遗留：`CONTEXT.md` / ADR 更新仍由 issue 05 处理。
