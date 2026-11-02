---
name: usage-check
description: 查询 OpenCode Go 和 MiniMax Token Plan 的订阅额度、已用量、剩余百分比与重置时间，并配置对应的 API key。当用户问“额度/余额/用量/还能用多少/什么时候重置”，或要配置 opencode、minimax 的 key 时使用。
---

# 额度查询

零依赖脚本，key 保存在 `~/.config/pi-work-usage-check/keys.json`（目录 0700、文件 0600）。

```bash
S=<本 skill 目录>/scripts/usage_check.py
python3 $S                 # 查询全部已配置来源
python3 $S opencode        # 只查 OpenCode Go
python3 $S minimax         # 只查 MiniMax（已配置的区域）
python3 $S --json          # 机器可读输出
```

口径：OpenCode Go 的 `percent` 是**已用**百分比；MiniMax 是**剩余**百分比。回答用户时保留这个区别，别把 39% 说成“还剩 39%”或反之。

## 未配置 key

脚本会以退出码 2 提示缺少哪个 key。把提示里的命令原样告诉用户，拿到 key 后执行：

```bash
python3 $S set-key opencode <key>
python3 $S set-key minimax-cn <key>        # 国内站 minimaxi.com
python3 $S set-key minimax-global <key>    # 国际站 minimax.io
```

- 回复里只出现脚本打印的掩码 key，用户没主动贴出时也不要索要完整 key 以外的信息。
- 同一把 MiniMax key 通常只属于一个区域；国际站返回 `invalid api key` 就换另一个区域。
- 删除：`python3 $S unset-key <opencode|minimax-cn|minimax-global>`。

环境变量优先于配置文件，适合临时使用：`OPENCODE_GO_API_KEY`、`MINIMAX_CN_API_KEY`、`MINIMAX_API_KEY`。

## 失败对照

- OpenCode 401/403：key 无效或 Go 订阅未开通；脚本会附上提示。
- MiniMax `invalid api key` / 1004：不是订阅 Key，或区域选错。
- 网络错误：MiniMax 会自动切换备用域名；仍失败再检查代理（`HTTPS_PROXY` / `ALL_PROXY`）。

自定义网关：`OPENCODE_GO_BASE_URL`，默认 `https://opencode.ai/inference/go/v1`。
