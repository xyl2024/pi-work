# 05: 命令面板入口

**What to build:** 除了工具条那个小图标，用户还能从命令面板（⌘K）切换权限模式：完全访问时那一条是「切换到确认危险命令」，否则是「切换到完全访问」。走的是同一条变更路径，不是第二套实现。

只在有当前会话时出现——草稿上出现一个不生效的开关比没有更糟。这个入口存在的原因是：一个只住在小图标上的高危开关，有个键盘入口反而更容易被用户发现和关掉。

**Blocked by:** 02

**Status:** done

- [x] 命令面板里新增一条切换权限模式的条目，文案随当前状态变化
- [x] 没有当前会话时不出现这一条
- [x] 选中后走与工具条按钮完全相同的变更路径，界面状态与工具条、徽章同步更新
- [x] 文案中英双语齐全

## Comments

- `buildCommands()` 里新增 `session.permission_mode`，标题随状态取「切换到完全访问 / 切换到确认危险命令」，
  `when: (c) => !!c.agentControls?.setPermissionMode`——`ChatWindow` 只在有真实会话时才注册这个 handler，
  所以草稿上这一条自然不出现，而不是靠一个另查的 `hasSession` 判据。
- 走的是同一条路径：`run` 调 `agentControls.setPermissionMode`，它就是工具条按钮调的
  `handlePermissionModeChange`（`hooks/useAgentSession/hook.ts`），成功后同时写运行时状态与跨会话索引，
  所以工具条、描边、徽章、面板一起变。
- 「点一下会切到哪一档」这件事只在 `lib/shared/permission-mode.ts` 的 `flippedPermissionMode()` 里决定，
  工具条与命令面板都问它，不会出现两处翻转方向相反。
- 回归测试 `tests/unit/permission-mode-command.test.ts`：标题两档、无会话时不出现、以及**按面板的真实调用方式
  （`run()` 不带参数）**触发。后面这条是补的——第一版写成 `run: (c) => c.agentControls…`，而命令面板一直
  是用 `run(undefined)` 调用（每个命令都闭包捕获构建时的 ctx），于是条目会出现、点了却抛异常。
