# 02: 图标偏好存储与 API 通道

`Category: enhancement`
`Status: resolved`

**What to build:** **图标偏好**（用户对某模型「自动匹配图标 ↔ provider 图标」的二态选择）的持久化与全链路下发。Pi Work 数据目录下新增 JSON 小 store（仿 favorites store 模式，尊重数据目录环境变量覆盖），key 为 `provider:modelId`，**只记偏离项**：切到 provider 图标记一条，切回匹配图标即删除该条目；偏好写回提供一个小 route；`/api/models` 响应新增偏好字段，与 `modelIcons` 并列；聊天会话 hook、翻译面板、定时任务 meta 三条既有拉取路径把偏好原样透传给图标解析函数。写坏或缺失的偏好按无偏离处理。

**Blocked by:** 01（需要最终解析函数签名与偏离语义）

- [ ] JSON store 落在 Pi Work 数据目录下，尊重整体数据目录环境变量覆盖；文件缺失/损坏/含未知值时按无偏离处理
- [ ] store 只存偏离项：`provider:modelId` → provider 图标偏好；切回匹配图标即删除记录，文件不存「用匹配图标」的正向条目
- [ ] 切换写回 route 可对单个模型设置与清除偏好
- [ ] `/api/models` 响应包含偏好字段，与 `modelIcons` 并列下发
- [ ] 聊天 hook、翻译面板、定时任务 meta 三条既有路径透传偏好给图标解析函数
- [ ] 用隔离实例的 `api` helper 走真实 HTTP 验证：写一条偏好后 `/api/models` 可查到、清除后消失；测试不污染真实用户数据目录
- [ ] TypeScript 检查与 ESLint 通过

## Comments
