# Context composition is estimated locally and anchored to provider usage

聊天区的上下文窗口圆环由 pi 的 `getContextUsage()` 驱动，其总量是 provider 回报的精确值（`usage.input/output/cacheRead/cacheWrite`，经 `calculateContextTokens`，见 `dist/core/compaction/compaction.js:86-88`），但**只是一个总数**。用户要的是构成：system prompt、系统工具定义、Skills、各类消息各占多少。

**没有任何 provider 会给出分段真值。** Anthropic 只回 `input_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`（`@earendil-works/pi-ai/dist/api/anthropic-messages.js:409-412`），OpenAI 与 Gemini 同理。因此本地估算不是退路，是唯一路径——问题只剩"用哪种估算"。

最便宜的 `chars/4` 是错的，且错得与分类边界共谋。实测本项目真实的 10 类内容（用 `gpt-tokenizer/o200k_base` 当真值）：各段**占比倍数跨 0.63x–1.46x（2.3 倍）**——中文 `AGENTS.md` 真实占 20.8% 而 `chars/4` 报 13.5%（低报 35%），中文用户消息低报 37%，英文 assistant 文本高报 46%。而**总量只差 −7.4%**，因为误差互相抵消了；这正是陷阱：一个校准良好的总量会掩盖一个系统性错误的构成。偏差与分类边界结构性对齐（本项目的 system prompt / AGENTS.md / 用户消息是中文，assistant 文本与工具 schema 是英文），所以它不会被"同一个算法"抵消——`E_i/ΣE_j = T_i/ΣT_j` 仅当各段偏差系数相等时成立。

**我们决定**：分类比例用一个与 provider 无关的通用 tokenizer 计算，并归一化到 provider 上报的精确总量。契约是**总量精确、比例可信**——UI 上总量不加任何修饰，分类数字加 `≈` 前缀，并在 popover 里用一行文字说明两者来源不同。选区 `gpt-tokenizer` 的单一 `o200k_base` 编码（服务端专用、dynamic import、BPE ranks 2.4MB），理由是它对 CJK 的覆盖率远好于 `cl100k_base`（后者中文要多 1.5–2x token），作为"通用代理 tokenizer"最合适。

自洽口径是**一条全局归一化**：本地算出每个叶子的计数，再用 `k = T_total / Σ local` 统一缩放，每个父节点等于其子节点之和。这样 `Σ 叶子 = k × Σ local = T_total` **按构造成立**，永不为负，也不需要"残差归给谁"的二次规则。system prompt 内部额外用**前缀差分**——tokenize 每个边界的完整前缀，相邻差即为该段——因为 BPE 会在段边界重新合并，独立 tokenize 各段再相加是对不上整段的；前缀差分让 system prompt 的各个子段之和恒等于该桶。

**不做"协议开销（未归类）"这一行**，尽管它看起来有信息量。provider 只回一个 prompt 总数，所以"provider 的胶水开销有多大"与我们自己的 tokenizer 失配量在数学上**不可分离**——用 o200k 去量 Claude，±5% 的失配（200k 上下文里是 ±10k）足以吞掉真实胶水开销（约 1–3k）并翻转符号。于是这一行会是负数或需要钳制，而负数**不是边缘情况而是常态**。显示一个由 tokenizer 误差主导、符号随机翻转的数字，比不显示它更糟。

## Considered options

- **`chars/4`，不引依赖。** 拒绝：占比偏差 2.3 倍，且偏差方向与分类边界对齐。它能让"涨到 180k 了"变得好看，但会让"砍掉 AGENTS.md 能省多少"这类决策算错方向。
- **自研内容类型感知的启发式**（CJK ~1.5 tok/char、ASCII ~0.25）。拒绝：这是自己造一个更差的 tokenizer，换来 ±10% 而非 ~2% 的误差，且一份需要长期维护、遇到新语言/新格式就退化的手工规则。
- **provider 的 count_tokens 接口**（Anthropic `POST /v1/messages/count_tokens`、Gemini `models.countTokens`）。拒绝，两个独立原因：其一，它只回**总数**，拿不到分段，满足不了需求；其二，Anthropic 官方文档自己称其为 estimate（"The token count is an estimate. In some cases, the actual number… might differ by a small amount"），而 OpenAI 的 Chat Completions 根本没有该接口。
- **按 provider 切换编码**（`cl100k_base` + `o200k_base`）**或逐模型 tokenizer 包**（`@lenml/tokenizer-<model>`）。拒绝：前者只让 OpenAI 系变准，而占大头的 Anthropic 依然只能估算——**引入一个只在部分会话生效的精度差异，会让人以为其余的会话不准**；后者的模型列表运行时才可知（`app/api/models/route.ts:151-198` 从 pi SDK 目录 + 用户 `models.json` 读取），会把"可插拔"变成运行时依赖解析。

## Consequences

- `lib/server` 首次引入 tokenizer 依赖。2.4MB 的 BPE ranks 决定了它**只能服务端 dynamic import**，绝不能进浏览器 bundle（AGENTS.md 的跨层禁令）。
- 分段边界的识别逻辑已经存在，但困在 `components/app-shell/AppShell.tsx`（`:261` `splitSystemPrompt`、`:296` `BASE_HEADING_ANCHORS`、`:305` `SKILLS_SECTION_RE`、`:309` `findPiDocsEnd`、`:316` `hasAppendSection`、`:322` `splitBaseBlocks`），而该文件第 1 行是 `"use client"`。要在服务端复用必须先下沉到 `lib/shared`。
- `system prompt` 与 `系统工具定义` 是两个量级差 50 倍的东西（工具 JSON schema ~1300 token vs prompt 里那几行 `- read: …` 清单 ~30 token），而右栏 Context 面板已有一个同名 anchor 叫 `Available tools`（`AppShell.tsx:296`）指的是后者。UI 必须让两者各归其位，否则"关掉一个工具能省多少"会被算错。
- Kanban 的卡片圆环走 JSONL 回退路径（`lib/server/kanban/session-context.ts:198-212`），拿不到 `agent.state`，因此拿不到 systemPrompt 与 tools，**不显示构成**。同一个会话在两个 surface 给出不同分类，比其中一个没有分类更糟。
- Anthropic 从未公开真实 tokenizer，`@anthropic-ai/tokenizer` 是 GPT-2 时代的近似实现且已废弃。因此 Claude 会话的比例误差不会通过换编码消除——这个契约对 Claude 是**一等公民而不是例外**。
- 全局归一化有一个要认的后果：单个桶的绝对数不是"本地直接计数"，而是"按本地比例分摊到 provider 精确总量"。既然本地计数本身带 ±2% 的 tokenizer 误差，分摊值反而更贴近 provider 的真实分配；但读代码的人会看到"token 数"经过了两次变换，需要注释讲清楚。
