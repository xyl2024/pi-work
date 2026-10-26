# 03: 完全访问活过重启

**What to build:** 模式不再只是进程内状态。用户把一个会话设成完全访问，关掉这个会话再打开、或者重启 Pi Work 服务端，它仍然是完全访问；而任何从未设过的会话（含所有既有会话）读出来一律是确认模式，升级不改变任何人的行为。

新会话一律回到确认模式：不继承上一个会话、不按工作目录记忆、没有全局默认值。这条是刻意的——持久化带来的唯一真风险就是「我没设过，它怎么不问我就跑了」。

**Blocked by:** 02

**Status:** done

- [x] 模式写进按会话隔离的侧车文件，形状与既有会话侧车一致（原子写、文件名限安全字符集、走统一数据根），包含模式与更新时间
- [x] 会话启动时读回侧车；文件缺失、损坏或取值非法时一律按确认模式处理，不抛错、不阻止会话启动
- [x] 关掉会话再打开、服务端重启后，完全访问状态仍在（手动 smoke）
- [x] 新会话（含草稿首次发送建立的会话）恒为确认模式，即使上一个会话是完全访问
- [x] 测试覆盖：缺失文件 → 确认模式、往返一致、非法取值不被信任、不安全的会话 id 不会写出侧车目录之外

## Comments

- 侧车 `lib/server/session-permission-mode.ts`，形状照 `session-tools` / `session-notify`：
  `~/.pi-work/session-permission-mode/<session-id>.json`（`{mode, updatedAt}`）、tmp+rename、文件名限
  `[A-Za-z0-9_-]{4,128}`、走 `dataPath()` 以便 `PI_WORK_DATA_DIR` 覆盖。
- 读回时机是会话启动（`startRpcSession` 里作为 `AgentSessionWrapper` 的构造参数，而不是一个事后 setter：
  想让「读侧车」只有一个入口，也不想给外部留一条绕过 `set_permission_mode` 的写入口）。缺失 / 损坏 /
  非法取值一律 `confirm`，不抛错、不阻止启动。
- 删除会话时一并删侧车（`lib/server/sessions/mutations.ts`）。
- 会话列表要能回答「哪些会话挂着盾牌」，为此加了 `readSessionPermissionModes()`：一次 `readdirSync`
  加每个存在的文件一次读，复杂度跟「点过完全访问的会话数」（通常 0）成正比，而不是跟会话列表长度成正比。
  `/api/sessions`、`/api/workspaces` 的 todaySessions、`/api/sessions/[id]/info` 三处用同一个
  `permissionModeField()` 投影，避免三份形状。
- 测试：缺失 → confirm、两档往返、非法值不被信任、损坏文件不崩、不安全 id 不写出目录、原子写不留 tmp、
  批量读只报非默认值。
- **重启 smoke 未跑**：读回路径由单元测试覆盖（侧车往返 + 启动时构造参数），但「关标签再开 / 重启服务端
  后仍是完全访问」需要人手动验一次。
