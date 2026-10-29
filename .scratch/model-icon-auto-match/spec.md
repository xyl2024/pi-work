# 模型图标自动匹配与偏好切换

`Category: enhancement`
`Status: ready-for-agent`

## Problem Statement

通过 API Key 或 Subscriptions（订阅）接入的模型，图标一律显示其 provider 的品牌图标。但同一个 provider 下常常挂着多个品牌的模型——例如订阅 `github-copilot` 下既有 `gpt-*` 也有 `claude-*`，API Key 中转类 provider 下的模型品牌更是五花八门。用户在模型配置面板给自定义模型挑图标时（从那张内置品牌图标库里选），一眼就能认出品牌；而同样是这些品牌，在 API Key / Subscriptions 的模型上却永远只能看到 provider 图标，认模型全靠读 id。

与此同时，现有机制还有一处缺陷：图标解析函数对内置 provider 直接短路返回 provider 图标，导致 models.json 里写的模型级 `icon` 覆盖字段对内置 provider 永远不生效。

## Solution

对 API Key / Subscriptions 来源的模型，按 model id 自动匹配品牌图标；匹配不到退回 provider 图标；用户可以在两者之间切换：

- 新建一张「model id 前缀/别名 → 图标库品牌图标」的内置映射表（小写归一）。`claude-*` 认出 Anthropic、`gpt-*` / `o3` / `codex-*` 认出 OpenAI、`gemini-*` 认出 Google、`glm-*` 认出智谱、`kimi-*` 认出 Moonshot、`qwen*` 认出通义等，共 10 个家族；未命中（如 `llama-*`，图标库无对应品牌）一律退 provider 图标。
- 图标解析全局改为三层优先级：**显式模型级 `icon` > 自动匹配 > provider 图标**，顺带修复「内置 provider 短路导致模型级覆盖失效」的缺陷。
- 匹配成功的模型，默认显示匹配图标；用户可在模型配置面板该 provider 的详情页里把单个模型切回 provider 图标，也可切回匹配图标。切换只对 API Key / Subscriptions 来源的模型开放（自定义模型已有图标挑选入口）。
- 匹配结果与 provider 图标相同（如 openai provider 下的 `gpt-*`）时，不提供切换入口。
- 切换偏好经 `/api/models` 下发，聊天工具栏、模型选择弹窗、助手消息头、翻译面板与气泡、定时任务表单与详情等全部图标消费点统一跟着变。

术语按 `GLOSSARY.md`：**图标库**（候选集）、**图标自动匹配**（规则推导）、**图标偏好**（用户二态选择）、**模型配置**（面板视图）、**模型目录**（runtime 探测的模型清单）。

## User Stories

1. 作为使用 ChatGPT 订阅的用户，我想让订阅下的 `gpt-*` / `codex-*` 模型显示 OpenAI 品牌图标，这样在模型选择弹窗里扫一眼就能确认品牌。
2. 作为使用 GitHub Copilot 订阅的用户，我想让 copilot 下的 `claude-*` 模型显示 Anthropic 图标、`gpt-*` 显示 OpenAI 图标，这样一个 provider 里混着的多个品牌各自可辨。
3. 作为通过 API Key 接入中转类 provider 的用户，我想让 provider 下各品牌的模型（qwen、glm、deepseek…）按品牌显示图标，而不是清一色的中转商图标。
4. 作为用户，我想让图标匹配完全自动、无需任何配置就开箱生效，这样我不必给每个模型手工挑图标。
5. 作为用户，当某个模型自动匹配出的图标不合我意时，我想把它切回 provider 图标，这样最终展示权在我。
6. 作为用户，当我把模型切回 provider 图标又反悔时，我想再切回自动匹配的图标，这样偏好随时可逆。
7. 作为用户，我想让切换偏好在聊天工具栏、模型选择弹窗、助手消息头、翻译面板、定时任务里同时生效，这样不会出现「面板里一个图标、聊天里另一个图标」的割裂。
8. 作为用户，我想让没匹配上的模型照常显示 provider 图标，这样自动匹配永远只是锦上添花、不会让显示变差。
9. 作为给自定义 provider 配过图标的老用户，我想让我已写的模型级 `icon` 覆盖继续优先于自动匹配，这样既有配置不被新规则悄悄改掉。
10. 作为给自定义 provider 配过 provider 级图标的用户，我理解自动匹配可能改变我现有模型的显示（如 `glm-*` 从 zai 图标变为按品牌匹配），并接受这一全局新优先级。
11. 作为用户，我想让匹配对大小写不敏感（`GPT-5` 与 `gpt-5` 同样命中），这样 vendor 命名风格差异不影响结果。
12. 作为用户，当匹配出的图标和 provider 图标本来就是同一个时，我不想看到切换入口，这样不会出现「切了没变化」的困惑。
13. 作为用户，我想在模型配置面板的 provider 详情页看到该 provider 目录下的全部模型及其当前图标，这样切换操作紧贴着模型列表进行。
14. 作为面对几十个模型的用户，我想让长模型列表默认折叠、按需展开，这样详情页不会被模型行淹没。
15. 作为用户，我想让偏好持久化在我的 Pi Work 数据目录里并随数据目录整体迁移（`PI_WORK_DATA_DIR`），这样多实例并存时偏好互不污染。
16. 作为不配置任何偏好的用户，我想让偏好存储文件保持为空或不存在，这样功能对我零负担。
17. 作为后续维护者，我想让前缀/别名表是一张独立的纯数据表，这样增加一个品牌家族不需要动解析逻辑。

## Implementation Decisions

- **图标解析的统一入口维持单一函数**：`resolveProviderIcon` 扩展签名，接收自动匹配表所需的 model id 与图标偏好字典，输出最终 icon id。三层优先级在函数内落地：显式模型级 `icon`（经现有 `modelIcons` 通道）> 自动匹配 > provider 内置图标。移除「内置 provider 先短路」的旧行为。
- **自动匹配表放 `lib/shared` 纯 module**：有序前缀/别名条目（不用正则；`o3` / `o4` 这类裸名用别名条目解决），输入小写归一；同品牌多图标条目一律取主品牌（不取 coding / token-plan / cn 变体）。初版收录 10 个家族：claude→anthropic、gpt/o 系/codex/chatgpt→openai、gemini→google、deepseek、glm/chatglm→zai、kimi/moonshot→moonshotai、qwen/qwq→qwen、minimax/abab→minimax、mistral/mixtral→mistral、grok→xai。图标库无对应品牌的家族（如 llama/meta）不收。
- **图标偏好存储为 Pi Work 自有 JSON 小文件**（数据目录下，仿 favorites store 模式，尊重 `PI_WORK_DATA_DIR` 覆盖），key 为 `provider:modelId`，值记录偏离项：切到 provider 图标记 `"provider"`，切回匹配图标即**删除**该条目，文件只保留真正的偏离。不写 models.json——那是 pi 的领地，且这些模型本就不在其中。
- **下发与写回走既有通道**：`/api/models` 响应新增偏好字段（与 `modelIcons` 并列），聊天会话 hook、翻译面板、定时任务 meta 三条既有拉取路径原样透传给图标解析函数；写回提供一个小 route，供详情页切换按钮调用。
- **切换 UI 在模型配置面板的 Subscriptions / API Key provider 详情页**：新增「模型」区块，列出该 provider 在模型目录下的全部模型（含当前未鉴权可见的），每行显示当前生效图标，匹配成功的行提供两态切换；超过 8 个模型默认折叠、点开全铺。模型目录页（「全部模型数据」）保持只读，不加入口；聊天模型选择弹窗保持纯展示。
- **切换入口的可见性规则并入纯函数**：匹配结果与 provider 图标相同、或该模型无匹配时，不显示切换入口；该规则与偏好解析同源，UI 只做薄壳。
- **自定义 provider 的模型不提供切换入口**：它们已有图标挑选字段（显式 `icon`），不造第二条重叠配置路径。
- **用户可见文案走 `useI18n` / i18n-dict 机制**，不硬编码单语言文本。
- **兼容性**：偏好文件缺失、损坏或含未知值时按无偏离处理；`resolveProviderIcon` 的既有调用点在偏好字典缺省时行为与「自动匹配 + 显式覆盖」一致。SSE 重连等场景不涉及（偏好非会话事件）。

## Testing Decisions

- 好的测试只测外部行为：给定输入断言输出 icon id / HTTP 响应契约，不测内部查表顺序等实现细节。
- **主缝（纯函数）**：`resolveProviderIcon` 连同新的匹配表，用 vitest 直接测——前缀/别名命中与未命中、小写归一、同品牌取主图标、三层优先级（显式 > 自动 > provider）、偏好偏离与切回（删除语义）、偏好字典缺省时的回退行为。先例：`models-config-draft.test.ts` 等 lib/shared 纯模块测试。
- **契约缝（HTTP）**：偏好 store 读写与 `/api/models` 新字段、切换写回 route，用隔离实例的 `api` helper 走真实 HTTP。先例：`favorites.test.ts`。
- UI 不开新测试缝：折叠阈值、入口可见性等决策已提入缝 1 的纯函数，遵循仓库「测纯逻辑不测渲染」的先例（`models-config-pages.test.ts`）。
- 不在测试中污染真实用户数据目录（遵循 `PI_WORK_DATA_DIR` / 隔离实例约定）。

## Out of Scope

- 从图标库任意挑选图标开放给 API Key / Subscriptions 模型（严格两态：匹配图标 ↔ provider 图标）。
- 先查「用户已配置的同名模型图标」再走前缀表的复用层（将来可作为第三层加在匹配表之前）。
- provider 级图标的切换或覆盖（内置 provider 的图标本身不变）。
- 模型选择弹窗、模型目录页上的任何交互入口。
- 新增图标集导入或扩充图标库本身（`@lobehub/icons` 深导入维持现状）。
- pi SDK / models.json schema 的任何改动。

## Further Notes

- 术语「图标库」「图标自动匹配」「图标偏好」已写入 `GLOSSARY.md`。
- 现有 `modelIcons` 覆盖通道（models.json 的 `icon` 字段）语义保持：只对 models.json 里的自定义 provider / 模型生效，但优先级随全局反转升级为「模型级 > provider 级」。
- 自动匹配全局生效（含自定义 provider 的模型）；受影响的现有显示变化已与用户确认接受。
- 实现后需跑 `tsc --noEmit` 与 ESLint；图标解析属纯客户端路径，无会话/流式事件/权限/后台任务面，无需额外 smoke 面。
