# 04: 切页回来不重复拉数据

**What to build:** 分页之后，几个「挂载时自己拉数据」的分区（Append System Prompt、Subagent settings、Agent retry、Network proxy）每切回来一次就重新请求一次，屏幕上先闪一下「Loading...」。本次让这些页在一个设置弹窗的生命周期内只拉一次：首次进入某页照常加载，之后来回切页直接复用上一次的结果，不闪烁、不重复请求。

明确约束：**只是缓存数据，不是保持挂载**。页组件仍然随切页卸载（这样「未保存改动 = 切走即丢弃」的判定才诚实），缓存放在弹窗层或模块级。若某个页的数据在别处被改动（例如子代理列表在编辑弹窗里保存后需要刷新），必须仍然能看到最新结果 —— 缓存不能变成「只读的旧快照」。

**Blocked by:** 01

**Status:** done

- [x] 首次进入 Append System Prompt 页，正常加载并展示内容。
- [x] 从 Append System Prompt 切走再切回，不出现「Loading...」闪烁，也不发起第二次请求（可用网络面板或计数验证）。
- [x] 四个页（Append System Prompt、Subagent settings、Agent retry、Network proxy）行为一致。
- [x] 在 Subagent settings 里编辑并保存一个子代理后，列表立刻反映最新结果，不显示缓存里的旧数据。
- [x] 关闭设置弹窗再打开，数据重新拉取（不跨弹窗复用陈旧数据）。
- [x] 加载失败后的状态不会被当成有效缓存：下次进入该页仍会重试。

## Comments

- 2026-10-20: 已实现。新增 `lib/client/settings-page-cache.ts`（纯缓存，无 React / fetch / 浏览器 API）与
  `components/settings/use-page-data.ts`（接线 hook）。缓存按设置弹窗实例创建：`SettingsModal` 用
  `useMemo` 建一份、随弹窗卸载丢弃，所以关窗再开会重新拉取。首次进入某页照常 `fetch`；再次进入直接读缓存，
  不请求也不显示 `Loading...`。页组件本身仍然随切页卸载，草稿（Append System Prompt 的 textarea、
  Network proxy 的地址草稿）仍然「切走即丢弃」。
- 四个页的落地：Append System Prompt / Subagent settings / Agent retry 三页的挂载读取走同一个缓存；
  Network proxy 其实没有挂载时请求（地址/旁路来自弹窗打开时已读入的 config store，只有按钮触发的
  `proxy-test`），因此没有可缓存的数据、也不会闪 `Loading...`，已在组件注释里写明。Profile 页不在本
  issue 范围，未改动。
- 新鲜度：Subagent 保存/删除后调 `reload()` 强制重读，结果同时写回缓存与列表，不会看到保存前的旧列表；
  Append System Prompt 保存后把新内容 `mutate` 进缓存。`refresh` 遇到同 key 的 in-flight 读取会先等它
  结束再重读，避免拿到保存前发出的旧响应；失败（首次或 refresh）都不会留在缓存里，下次进入重试。
- 缓存 key `SETTINGS_PAGE_DATA_KEYS` 用 `satisfies readonly SettingsSectionId[]` 钉在注册表上；新增
  待加载页需要同时声明 key 与 payload 类型，漏了会 `tsc --noEmit` 报错。
- 验证：`tsc --noEmit`、改动文件 ESLint、`pnpm test`（92 files / 1179 tests）通过；新增
  `tests/unit/settings-page-cache.test.ts` 覆盖首次加载、命中缓存不再请求、并发共享请求、强制刷新、
  refresh 等待 in-flight、失败不缓存、refresh 失败丢弃旧值、key 与注册表一致。未启动 UI 做手动 smoke
  （切页无闪烁、网络面板请求计数按代码接线核对，未在浏览器里点过）。
