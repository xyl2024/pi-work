# 03: 记住上次停留的设置分区

**What to build:** 关掉设置弹窗再打开，回到上次停留的那一页，而不是每次都从个人资料开始。没有任何记录时回落到个人资料；记录的值不认识（比如那一页已经下线、或存储里是脏数据）时也回落到个人资料，绝不把设置打开成一个空白页。存储不可用（隐私模式、配额满、被禁用）时静默失败，功能降级为「永远落到个人资料」，不报错、不崩。

读写行为照仓库已有的「极小 localStorage 模块」惯例：可注入 storage 以便测试、写入失败静默、读到不认识的值返回空。分区 id 必须对着设置注册表校验，不能信任存量值。键名沿用仓库既有的 `pi-work:` 前缀风格。

**Blocked by:** 01

**Status:** done

- [x] 在「Agent retry」页关闭设置，再次打开落在「Agent retry」。
- [x] 首次使用（无记录）打开设置落在「Profile」。
- [x] 存储里的值被改成不存在的分区 id 时，打开设置落在「Profile」且不报错。
- [x] 存储不可用时（注入一个抛异常的 storage）打开设置落在「Profile」且不报错。
- [x] 存储模块有单测：往返一致、存储不可用返回空、无法识别的值返回空。
- [x] 记录的写入发生在切页时，而不是每次渲染时。

## Comments

- 2026-10-20: 已实现并提交。新增 `lib/client/last-settings-section.ts`（`pi-work:last-settings-section`）：
  纯字符串负载、可注入 storage、写入与读取失败静默；读取时用注册表新增的
  `isSettingsSectionId()` 校验，无法识别/缺失/存储不可用一律返回 `null`，弹窗回落到注册表新增的
  `DEFAULT_SETTINGS_SECTION_ID`（`profile`）。弹窗用惰性 `useState` 初始化器在每次打开时读取一次
  （弹窗由 AppShell 条件挂载，关闭即卸载），`goToSection` 里仅在目标页不同于当前页时写入，
  渲染路径不写 storage。同时把 `last-used-model.ts` 里重复的 localStorage 访问器抽到
  `lib/client/local-storage.ts`。
- 验证：`tsc --noEmit`、改动文件 ESLint、`pnpm test`（91 files / 1169 tests）通过；
  未启动 UI 做手动 smoke（四条 UI 行为按代码接线核对，未在浏览器里点过）。
- 评审遗留：本 issue 不在范围，`CONTEXT.md` / ADR 更新仍由 issue 05 处理。
