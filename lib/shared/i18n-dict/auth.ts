// Login / logout authentication gate vocabulary.

export const auth = {
  "Sign in": "登录",
  "Signing in...": "正在登录...",
  "Username": "用户名",
  "Password": "密码",
  "Invalid username or password": "用户名或密码错误",
  "Login failed": "登录失败",
  "Username and password are required": "请输入用户名和密码",
  // Shown on the login page when PI_WORK_AUTH_PASSWORD is not configured and
  // the built-in admin/admin pair is active.
  "Default credentials hint (username)":
    "未配置 PI_WORK_AUTH_USERNAME / PI_WORK_AUTH_PASSWORD，默认账号：{username} / admin",
  "Log out": "退出登录",
  "Logged out": "已退出登录",
} as const;
