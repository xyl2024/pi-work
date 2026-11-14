# 一套刻度、三档浮起：pi-work 的视觉语言向 DeepSeek Harness 靠拢

pi-work 的界面一直是「能用的拼装品」：228 个 `.tsx` 里 161 个写着内联 style，共 1806 处；颜色字面量 523 处散在 104 个文件；圆角同时存在 2/3/4/5/6/7/8/9/10/12/14/16/18 与 999；按钮高度从 20 到 36 有 11 档；过渡时长 0.08s 到 0.3s 有 8 档；`--danger` 这个 token 被 6 处引用却从未定义。设计 token 层原本只有 29 对颜色和 4 个几何值，圆角、间距、字号、时长、阴影、边框宽度全是零。

参考对象是 DeepSeek Harness 的 Web 端：它的视觉规则由 `ui-theme` 携带，分三层 token（static 色阶 → alias 语义 → 特性专用），组件只消费 alias；圆角只有 6 档且被测试钉住；浮起面一律「无边框 + 一层阴影」；焦点环 2px 且指针操作时不显形；滚动条 5px、轨道透明。

**我们决定**：抄它的**语言**，不抄它的**结构**。pi-work 是编码 agent 的工作台（三栏 + 终端 + 面板），不是聊天 harness；照搬分区、导航、消息流结构只会得到一件不合身的衣服。语言层面的采纳是：

**一、补一层刻度，颜色与几何分开。** `app/globals.css` 的 `:root` 新增圆角（`--radius-xs` 4 / `sm` 8 / `md` 12 / `lg` 16 / `xl` 20 / `pill`）、字号（`--fs-11`…`--fs-24`）、控件高度（`--control-sm/md/lg`）、动效（`--dur-fast/base/slow` + `--ease-standard`/`--ease-out`）、焦点环（`--focus-ring-width`）。这些值不随主题变化，所以留在 `:root`；颜色才进 `.theme-light` / `.theme-dark`。

**二、颜色改成「一档语义一层」的命名，并把语义补齐。** 保留既有 token 名（`--bg`、`--bg-panel`、`--border`、`--text`…），因为 1806 处内联样式在引用它们，改名等于同时改 161 个文件；补的是缺的那几档：

- 面：`--bg-app`（外壳底）、`--bg`（卡片/聊天）、`--bg-panel`（侧栏、输入底座）、`--bg-elevated`（浮层）。
- 线：`--border`（可见分隔，10%~12% 黑/白）、`--border-soft`（4%~7%）、`--panel-border`（面板外框）。
- 字：`--text` / `--text-muted` / `--text-dim` 三级。
- 交互：`--bg-hover` / `--bg-selected` 改成**半透明**（浅 `rgba(38,49,72,0.06)` / 深 `rgba(255,255,255,0.08)`）。这是这一轮最省事也最见效的一刀：同一份悬停规则落在白卡片、灰侧栏、浮层上都对，不再需要「侧栏另配一套 `--bg-hover`」。
- 浮起：`--elevation-1/2/panel/prominent/soft`，每档都带一条 0.5px 的 `--elevation-stroke-color` 发丝，替代「边框 + 阴影」双描边。
- 语义色：`--success/warning/error/info` 与其 `-bg`、`--danger`（此前是幽灵 token）、`--git-status-*`。
- 滚动条：`--scrollbar-thumb` / `--scrollbar-thumb-hover`，深色不再复用 `--border` 导致几乎看不见。

**三、浮起靠阴影，不靠边框。** 菜单、tooltip、toast、确认框、设置面板一律 `border: 0` + 一档阴影，底色 `--bg-elevated`；三个主面板（侧栏、聊天、右栏）保留 1px `--panel-border`，因为它们不是浮层而是并排的容器，阴影在这里只会变成四条灰边。

**四、核心控件从「JS 改样式」迁到 CSS。** `IconButton`、`ToggleSwitch`、`TabBar`、`ContextMenu`、`RightBarButton` 各自有了 CSS Module：悬停写在 `@media (hover: hover)` 里，焦点交给全局 `:focus-visible`，尺寸与圆角取 token。仓库里还有 111 处 `onMouseEnter` 直接改 `currentTarget.style`，这轮不动它们——它们是同一个问题的剩余部分，逐个迁移比重写安全。

**五、恢复可见焦点。** 原来 `*:focus, *:focus-visible { outline: none !important }` 一刀切，代价是键盘用户在会话列表、聊天、文件树里完全没有焦点指示（ADR-0041 承认过这条 WCAG 2.4.7 妥协）。现在 `:focus` 清 outline、`:focus-visible` 画 2px `--focus-ring-color`，表单控件排除在外（它们自己画环）。这是这轮唯一一条「可见行为被改回去」的规则，写在这里免得下次又被当成噪音删掉。

**六、少量版式向参考实现靠拢**：用户气泡用 `--radius-xl` 且去掉边框、输入卡 `--radius-xl`、消息 markdown 标题改成 1.4/1.24/1.1/1em 的固定阶梯（原来全是相对 em，实际只有 16px 上下）、代码块与内联 code 用 `--radius-md`/`--radius-xs`、外壳从「12px 内边距 + 一圈边框」改成「10px 内边距 + `--bg-app` 底 + 卡片浮在上面」。

## Considered options

- **把 token 全部改成参考实现的 `--dsw-alias-*` 命名。** 语义更干净，但要同时改 161 个文件、1806 处内联样式，且改完的收益只在命名上；本轮的选择是「补齐 + 局部新名」，让新代码能用好名字，旧代码继续跑。
- **一次性把 1806 处内联 style 拆成 CSS Module。** 这是最终方向，但它是一个逐组件、逐视觉验收的长期工程；一轮做完等于把整个前端重写一遍，风险与收益不成比例。本轮只把**共享控件**先收进 Module——它们复用次数最多，改动一处影响面最大。
- **照参考实现把主按钮做成黑底。** 参考实现的 `brand-primary` 是近黑（浅色主题下），这是它的品牌选择。pi-work 的主操作（发送、保存、确认）一直用 accent 蓝，换成黑会丢掉「哪里能点」的第一眼线索；我们只把蓝色校准到同一支品牌蓝（`#4176e6` / `#7aaaff`）。
- **连结构一起抄（侧栏收起成 56px rail、设置分区插槽化）。** 那是产品结构决策，不是视觉语言。ADR-0019 已经把设置的信息架构定在注册表上；侧栏折叠另有交互语义（会话列表是主入口）。这轮不碰。
- **保持全局无焦点环。** 它至少是「一致的」，但一致性不等于正确：键盘用户在半个应用里看不到自己在哪。恢复焦点环的成本只是「输入框要排除」，没有理由再拖。

## Consequences

- 新样式优先用 token，不再写颜色/圆角/时长字面量；`--bg-app`、`--bg-elevated`、`--border-soft`、`--elevation-*` 是新代码的默认选择。
- 悬停色是半透明的，意味着**不能**再拿 `--bg-hover` 当不透明填充去盖住下层内容（例如需要遮住文字时用 `--bg-panel`）。
- 焦点环恢复后，个别自带 `box-shadow` 焦点的控件可能出现「环 + 阴影」双层；发现一个就在该控件上把 `outline: none` 补回去，不要改全局规则。
- 深色主题的底色整体压暗（`#1e1e20` 卡片 / `#161618` 外壳），并且从中性灰蓝转向中性灰；依赖「深色偏蓝」的插图与截图会显得色偏。
- 这轮没有动 `onMouseEnter` 的 111 处、没有动 36 处漏标 `data-scroll-*` 的滚动区、没有动 Tailwind 的 5 个文件里 12 处 arbitrary 值；它们是同一笔技术债的剩余部分，下次迁控件时顺手带走。
- 视觉规则不再写在 CSS 注释里（ADR-0040）。读不出来的约束进本篇与 ADR-0041。
