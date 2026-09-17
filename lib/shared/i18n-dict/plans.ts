// Plans panel (right-side). Keys are English source strings mapping to
// Chinese; EN_TRANSLATIONS is the identity for missing keys. `plans.inbox` is
// namespaced because the plain "Inbox" key already means the message center.
export const plans = {
  "Plans": "计划",
  "Open plans": "打开计划",
  "New plan": "新建计划",
  "plans.inbox": "收件箱",
  "plans.week": "本周",
  "plans.month": "本月",
  "Tomorrow": "明天",
  "{range} (in {month})": "{range}（属 {month}）",
  "Upcoming": "即将到来",
  "{n} overdue open plans": "过期未完成 {n} 项",
  "No plans yet": "还没有计划",
  "Failed to load plans": "加载计划失败",
  "Failed to create plan": "创建计划失败",
  "Record a plan; press Enter": "记一条计划，回车创建",
  // Completion
  "Hide completed": "隐藏已完成",
  "Show completed": "显示已完成",
  "All plans are completed": "计划都已完成",
  "Toggle done": "切换完成状态",
  "Failed to update plan": "更新计划失败",
  // Inline note editing
  "Add a note…": "写点备注…",
  "Plan saved": "计划已保存",
  "Failed to save plan": "保存计划失败",
  // Plan detail dialog (#51): the note is written on the left and previewed on
  // the right, or one pane plus an 编辑 / 预览 switch when the dialog is narrow.
  // "Plan details" is the dialog's accessible name. "Edit" / "Preview" / "Words"
  // / "Characters" / "Close" already exist in the common and notes
  // dictionaries and are reused.
  "Plan details": "计划详情",
  "No note yet": "还没有备注",
  // Row actions. "Copy path" / "Copied" / "Delete" / "Cancel" / "Saved" /
  // "Saving" / "Unsaved changes" / "Save failed" already exist in the common,
  // notes and media dictionaries and are reused as-is.
  "Path copied": "路径已复制",
  "Copy path failed": "复制路径失败",
  // Re-scheduling: a different anchor is a move, so the row's chips say where
  // the plan goes and the server renames the file (ADR-0006).
  "Reschedule": "改期",
  "Move plan to": "改到",
  "Failed to reschedule plan": "改期失败",
  "A plan with that name already exists": "目标位置已有同名计划，未改动",
  "Delete plan?": "删除这条计划？",
  "This deletes the plan file permanently.": "这会永久删除该计划文件。",
  "Plan deleted": "已删除计划",
  "Failed to delete plan": "删除计划失败",
  "The plan no longer exists": "该计划已不存在",
  // Mini month calendar (#47): Monday-first, counts from the loaded plans,
  // click a day / week / month to pick that anchor for the next plan.
  "Calendar": "月历",
  "Expand calendar": "展开月历",
  "Collapse calendar": "收起月历",
  "Select this month": "选择整月",
  "Select this week": "选择这一周",
  "Mon": "一",
  "Tue": "二",
  "Wed": "三",
  "Thu": "四",
  "Fri": "五",
  "Sat": "六",
  "Sun": "日",
  "{n} plans": "{n} 项计划",
  "New plan anchor": "新建锚点",
  // Appearance modes (#48): one three-cell switcher in the panel header. Keys
  // are namespaced because the plain "Compact" / "Timeline" keys already mean
  // something else in the chat dictionary.
  "plans.view.label": "计划外观",
  "plans.view.compact": "紧凑",
  "plans.view.cards": "卡片",
  "plans.view.timeline": "时间轴",
  // 待整理 (unsorted): files that break the naming / frontmatter contract. They
  // are listed with the parser's complaint and are never rewritten by Pi Work,
  // so the wording must say what to fix and where (ADR-0006).
  "Unsorted": "待整理",
  "These files do not follow the plan convention. Pi Work never rewrites them — fix them outside the panel and refresh.":
    "这些文件不符合计划约定。Pi Work 不会改写它们，请在外面修好后刷新。",
  "The file is not in a plan folder (inbox/ or YYYY-MM/)":
    "文件不在计划目录里（应为 inbox/ 或 YYYY-MM/）",
  "The file name does not follow the plan naming rule": "文件名不符合计划命名规则",
  "The date in the file name is not a real date": "文件名里的日期不是真实日期",
  "A week anchor must be named by its Monday": "周锚点的日期必须是周一",
  "The month folder and the date in the name disagree": "月份目录与文件名里的日期不一致",
  "The frontmatter could not be parsed": "frontmatter 无法解析",
  "done must be true or false": "done 只能是 true 或 false",
  "created_at is not a valid timestamp": "created_at 不是合法时间戳",
  "done_at is not a valid timestamp": "done_at 不是合法时间戳",
  // Write conflicts (409)
  "This plan changed outside the panel": "这个计划已在面板外被改动",
  "This plan was moved or renamed outside the panel": "这个计划已在面板外被移动或改名",
  "Overwrite": "覆盖",
  "Reload": "重载",
  "Reload to the new location": "重载到新位置",
  "Dismiss": "忽略",
};
