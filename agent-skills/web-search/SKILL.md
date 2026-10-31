---
name: web-search
description: 通过 DeepSeek Search / Fetch API 搜索网页和抓取页面全文。当需要联网获取最新信息、核实事实、查阅文档时使用。
---

# DeepSeek Search & Fetch

脚本随 skill 一起分发、零依赖，路径相对本 SKILL.md 所在目录：

```bash
S=<本 skill 目录>/scripts/ds_web.py
python3 $S search "关键词"     # 可选 --count N(1-50, 默认10)  --content  --compact  --json
python3 $S fetch "URL"        # 可选 --max-chars N  --json
```

- API key 自动从 `$DEEPSEEK_API_KEY` 或 `~/.config/deepseek-search-fetch/key` 读取，无需处理。
- `search` 默认每条结果输出标题、URL、`站点 | 日期 | score | authority` 和长摘要；`score`(0-3，≥1.5 较好) 与 `authority`(0-4，≥3 权威) 用于判断可信度。`--compact` 换成短摘要，`--json` 输出原始 JSON。
- `fetch` 返回 `{title, content}`，content 是 Markdown；长页面加 `--max-chars` 防止撑爆上下文。
- 查询支持 `site:`、`-site:`、`"精确短语"`。
- 常规顺序：先 search 找 URL，只 fetch 真正需要的那 1-2 页；摘要已能回答就不必 fetch。两个接口按成功请求计费。

完整参数与错误说明见 `references/search-api.md`、`references/fetch-api.md`；官方文档：
- https://api-docs.deepseek.com/zh-cn/api/search.md
- https://api-docs.deepseek.com/zh-cn/api/fetch.md

