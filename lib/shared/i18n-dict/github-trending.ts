// GitHub Trending right-panel: toolbar, rows, README detail, status states.
//
// Notes:
//   - "Today" / "Refresh" / "Retry" / "Language" / "Loading..." /
//     "Failed to copy" already exist in common/settings; not re-declared.
//   - "This week" / "This month" exist in todos.ts ("本周内"/"本月内");
//     re-declared here with the trending-page's intended sense ("本周"/"本月").
//     The spread order (this module merges late) lets these win app-wide —
//     the todo filter label difference is immaterial.
//   - The period-stars text ("1,234 stars today") stays in the upstream
//     English per design — it is fetched data, not UI chrome.

export const githubTrending = {
  "GitHub Trending": "GitHub 热门",
  "Search language": "搜索语言…",
  "No match": "无匹配",
  "This week": "本周",
  "This month": "本月",
  "No trending repos": "暂无热门仓库",
  "Failed to load trending": "加载热门仓库失败",
  "Failed to load README": "加载 README 失败",
  "Cached data · last fetched {t}": "缓存数据 · 上次抓取 {t}",
  "Back to trending": "返回热门列表",
  "Copy clone URL": "复制克隆地址",
  "Clone URL copied": "已复制克隆地址",
  "Open on GitHub": "在 GitHub 打开",
} as const;