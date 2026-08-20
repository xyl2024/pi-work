// Multi-cwd sidebar / favorites / activity / session library.
// Session chrome (Sessions, Commands, etc.) lives in chat.ts since they
// share the sidebar component.

export const sessions = {
  // Multi-cwd sidebar
  "Loading projects...": "正在加载项目...",
  "No projects yet": "暂无项目",
  "Load more projects": "加载更多项目",
  "End of projects": "已到末尾",
  "Load more sessions": "加载更多会话",
  "View more sessions": "查看更多会话",
  "Search by name or content...": "按会话名或会话内容搜索…",
  "Loading sessions...": "正在加载会话...",

  // Favorites
  "Favorite session": "收藏会话",
  "Unfavorite session": "取消收藏",
  "Favorites": "收藏夹",
  "Open favorites": "打开收藏夹",
  "Hide favorites": "关闭收藏夹",
  "Failed to update favorite": "更新收藏失败",
  "No favorites yet — click ☆ on any session to add one.":
    "暂无收藏会话 — 点击会话上的 ☆ 即可收藏",

  // New-session welcome line (empty new-session screen greeting)
  "Hi, {name}, what shall we create together today?": "Hi，{name} 今天想一起创造什么？",
  "No activity in this workspace yet": "此工作区暂无活动",
  "Couldn't load activity": "无法加载活动数据",
  "session": "个会话",
  "sessions": "个会话",
  "+{n} more": "还有 {n} 条",
} as const;
