# 模型图标只来自显式配置

模型图标一度有两层推导：`lib/shared/model-icon-match.ts` 按 model id 的前缀 / 别名表自动推出品牌图标，另一层是用户在「模型配置」详情页逐模型选择的「自动匹配 ↔ provider 图标」偏好，存在 Pi Work 自有的 `model-icon-preferences.json` 里并经 `/api/model-icon-preferences` 写入、随 `/api/models` 下发。

这套推导带来的是猜测而不是信息：前缀表要持续跟着上游模型命名扩表，猜中的部分看着像配置、猜错的部分又要靠偏好逐条纠正；偏好本身又只覆盖 API Key / Subscriptions 的来源，导致同一个模型在不同入口长相不一致。图标本应是配置的事实，而不是命名的推断。

**我们决定**：

- 删除自动匹配：`lib/shared/model-icon-match.ts`、`lib/shared/model-icon-list.ts` 及其单测。
- 删除图标偏好：`app/api/model-icon-preferences/route.ts`、`lib/server/model-icon-preferences.ts`、`lib/client/model-icon-preferences.ts`、`lib/client/useModelIconPreferencesSync.ts`、`tests/unit/model-icon-preferences.test.ts`。
- 删除「模型配置」详情页的模型图标设置区：`components/panels/models-config/ProviderModelIconsSection.tsx` 及其样式，OAuth / API Key 详情页不再渲染它。
- 图标解析收敛为一条规则：`models.json` 里显式写的模型级 `icon` > 显式写的 provider 级 `icon` > provider id 自带的内置图标 > 默认齿轮图标。`resolveProviderIcon` 不再接受偏好参数。
- 摘掉随 `modelIconPreferences` 扩散的出处：`/api/models` 的响应字段、会话 hook 的状态、聊天 / 翻译 / 子代理 / 定时任务各组件的 prop、模型配置与定时任务的面板状态，以及只服务这套 UI 的中英文词条。

**不动用户数据**：已存在的 `model-icon-preferences.json` 原样留在磁盘上。Pi Work 不再读取或写入它，但也不会替用户删除。

## Considered options

- **保留前缀表、只去掉偏好 UI。** 图标的来源仍然是命名猜测，猜错时用户再无纠正手段，反而比现在更难解释。
- **把偏好降级为「全局开关」。** 仍然要给每个模型定义「匹配成功」长什么样，规则推导的成本一分没少。
- **自动把偏好写进 `models.json` 的 `icon` 字段。** 那是用户在 pi 侧的配置，Pi Work 把 UI 选择搬进去等于替用户改写自定义 provider / 模型定义。
