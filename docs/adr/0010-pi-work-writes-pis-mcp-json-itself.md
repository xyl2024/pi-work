# Pi Work 自己读写 pi 的 mcp.json，而不是调 SDK 的配置写入接口

MCP 面板要能增删改服务器，可 pi 的 `loadMcpConfig` / `validateMcpServerConfig` / `addMcpServerConfig` / `updateMcpServerConfig` 都没有从包根导出（`exports` 只开 `.`、`./rpc-entry`、`./client`、`./experimental/plugin`）。读路径早就因此自己镜像了一份 loader 与校验器（`lib/server/mcp-config.ts`，带 `tests/unit/mcp-config.test.ts` 钉住规则），写路径只能同样自建。

我们决定：写路径做**保留式读-改-写**——解析目标 `mcp.json`，只动这次提交涉及的那几个条目与顶层 `autoEnableCodemode`，其余内容（无效条目、未知顶层字段、键顺序）原样回写；缩进沿用文件里已有的那份，落盘形状与 pi 自己写的完全一致（`JSON.stringify` + 尾部换行）。校验复用同一份镜像，**先整批校验再落盘**，任何一条不合格就一条都不写。写口只有一个专用路由，不经过 `lib/server/file-access.ts` 的允许根（`~/.pi/agent/` 本来就在允许根之外，这正是 `~/.pi/agent` 只能由这类专用写口触碰的原因）。

## Considered options

- **只读，不做写。** 避开碰用户真实配置的风险，但今天改 MCP 只能手改文件，而 `~/.pi/agent/` 不在文件查看器的允许根里——等于没有界面。
- **解析-重建整份文件。** 实现最省事，但会丢掉无效条目与未知顶层字段：用户手里一条写错的服务器会被"保存"顺手删除。
- **让用户去用 pi 的 `/mcp` 命令或 TUI 改。** 跨进程、没有回执，界面无法回答"改没改成功"，我们也没接管 `createMcpExtension` 的 `updateConfig`。
- **只做 JSON 语法校验，不镜像 pi 的逐字段校验。** 面板会存下 pi 连接时才拒绝的条目，用户看到"保存成功"却一个服务器都没有。
- **连默认值一起写出来（`enabled: true`、`exposure: "codemode"`、空 `args`/`env`）。** 语义相同但文件变脏，且与 pi TUI 写出来的形状不一致；改成落盘前剥掉默认值。

## Consequences

- 镜像会随 pi 升级漂移：读侧规则由既有测试钉住，写侧新增的测试钉"不丢内容"这一语义（无效条目与未知键必须原样留在文件里）。
- 面板因此必须是**显式保存**（一次提交 = 一次读-改-写），不能每次按键落盘。
- `mcp.json` 的 JSON 语法坏掉时面板拒绝保存，只展示文件级错误——在不破坏内容的前提下没法改它。
- 写路径与别的写者（pi CLI / TUI、用户手改）之间仍然没有互斥，保存时以磁盘当前内容为基底做读-改-写，不做冲突检测。这是 ADR-0009 末尾记下的同一处取舍，不是这里新引入的。
