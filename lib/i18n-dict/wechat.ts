// WeChat — settings section + demo panel + workspace/session status bar.

export const wechat = {
  // Settings section (embedded in SettingsModal)
  "WeChat Connection": "微信连接",
  "Manage WeChat connection.": "管理微信连接。",
  "Discard unsaved changes?": "放弃未保存的修改？",

  // Demo panel
  "WeChat": "微信",
  "WeChat Demo": "微信演示",
  "Loading image": "正在加载图片",
  "Not logged in": "未登录",
  "Start QR login": "开始扫码登录",
  "Pairing code": "配对码",
  "Refresh QR": "刷新二维码",
  "Log out": "退出登录",
  "Send a test message": "发送测试消息",
  "Enter the recipient's WeChat id (must end with @im.wechat) and a message body.":
    "输入收件人的微信 ID（必须以 @im.wechat 结尾）和消息内容。",
  "Scan with WeChat, or open the URL on your phone:": "用手机微信扫一扫，或在浏览器中打开以下链接：",
  "WeChat account linked": "微信账号已绑定",
  "WeChat account logged out": "微信账号已退出",
  "Message sent": "消息已发送",
  "Hello from pi-work!": "你好，这是来自 pi-work 的消息！",
  "Account": "账号",
  "Known contacts": "已联系过的用户",
  "No contacts yet. Ask a friend to scan the QR above and send you a message — they'll appear here.":
    "暂无联系人。让朋友扫一下上面的二维码给你发条消息，他们就会出现在这里。",
  "New contact: {userId}": "新联系人：{userId}",

  // Workspace / session status bar
  "Current workspace": "当前 Workspace",
  "Current session": "当前 Session",
  "Not started": "未启动",
  "Not set": "未设置",
  "Switch workspace": "切换 Workspace",
  "Workspace switched": "Workspace 已切换",
  "No workspaces yet": "暂无 Workspace",
  "Account expired — please scan again": "账号已过期，请重新扫码",
} as const;
