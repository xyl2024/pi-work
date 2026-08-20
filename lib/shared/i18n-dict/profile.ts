// Profile section (avatar + username at bottom of sidebar).
// "Only PNG images are supported" and "File too large (max 5MB)" live
// in common.ts because the same strings appear in non-profile places.

export const profile = {
  "Profile": "个人资料",
  "Avatar": "头像",
  "Username": "用户名",
  "Upload avatar": "上传头像",
  "Remove avatar": "移除头像",
  "Profile saved": "个人资料已保存",
  "Failed to save profile": "保存个人资料失败",
  "Avatar uploaded": "头像已更新",
  "Failed to upload avatar": "上传头像失败",
  "Avatar removed": "头像已移除",
  "Failed to remove avatar": "移除头像失败",
  "Guest": "访客",
  "You": "你",
  "Avatar and display name shown at the bottom of the sidebar.": "设置侧边栏底部显示的头像和显示名。",
  "Your display name": "你的显示名",
  "PNG only · up to 5MB": "仅 PNG · 最大 5MB",
} as const;
