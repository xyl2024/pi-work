# 01: 图标自动匹配表与三层优先级反转

`Category: enhancement`
`Status: ready-for-agent`

**What to build:** 模型图标按 model id 自动认品牌，并修复模型级覆盖对内置 provider 永远不生效的缺陷。新建一张前缀/别名的**图标自动匹配**表（小写归一，只收**图标库**有对应品牌图标的 10 个家族，同品牌取主图标），图标解析改为三层优先级：显式模型级 `icon` > 自动匹配 > provider 图标，移除「内置 provider 直接短路」的旧行为。解析函数签名同时预留**图标偏好**参数（缺省按无偏离处理）。落地后无需任何配置：订阅或 API Key provider 下，`claude-*` 显示 Anthropic 图标、`gpt-*` 显示 OpenAI 图标；自定义 provider 里写了模型级 `icon` 的模型真正按该图标显示；未命中的模型照常显示 provider 图标。聊天工具栏、模型选择弹窗、助手消息头、翻译面板与气泡、定时任务等全部既有消费点立即生效。

**Blocked by:** None (can start immediately)

- [ ] 匹配表为 `lib/shared` 纯 module：有序前缀/别名条目（不用正则），输入小写归一，覆盖 10 个家族（claude→anthropic、gpt/o 系/codex/chatgpt→openai、gemini→google、deepseek、glm/chatglm→zai、kimi/moonshot→moonshotai、qwen/qwq→qwen、minimax/abab→minimax、mistral/mixtral→mistral、grok→xai）；图标库无对应品牌的家族不收
- [ ] 同品牌多个图标条目一律取主品牌（不取 coding / token-plan / cn 变体）
- [ ] 图标解析函数实现三层优先级：显式模型级 `icon` > 自动匹配 > provider 图标；内置 provider 不再短路
- [ ] 解析函数接受图标偏好字典参数，偏好缺省（空/未传）时行为与「自动匹配 + 显式覆盖」一致；偏好记为 provider 时跳过自动匹配直接用 provider 图标
- [ ] 既有消费点在未传偏好时全部正常工作（向后兼容）
- [ ] 纯函数测试覆盖：命中与未命中、裸名别名（`o3` 等）、大小写归一、同品牌取主图标、三层优先级、偏好偏离与缺省回退
- [ ] TypeScript 检查与 ESLint 通过

## Comments
