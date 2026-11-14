# 全局样式的非显然约束住在 ADR 里，不住在注释里

`app/globals.css` 原有 89 个注释块、310 行，讲的几乎全是「这行为什么不能改」：Chromium 把全透明 thumb 当作不存在、`scrollbar-color` 会级联进后代、CodeMirror 的选区层压在内容之下、Tailwind 的 `.table` 撞 Prism 的语法 token。按 ADR-0040，这些注释随清理一起删除；本文是它们的去处，只收**读代码读不出来的约束与有代价的取舍**，审美与版式细节仍由样式本身承担。

**我们决定**：

- **滚动条是三个预设加一个独立语义。** 滚动区靠 `data-scroll-<role>` 选：`wide` 12px（聊天主区、大弹层、主面板列表，滑块 4px 宽、靠 `border` + `background-clip: content-box` 内缩，悬停加深）、`side` 4px（侧栏会话与文件列表）、`inset` 6px（`maxHeight ≤ ~320px` 的小浮层）。`data-hide-v-scrollbar` 与它们无关，表示「彻底隐藏但仍可用滚轮/触摸/方向键滚动」（如聊天输入框）。
- **静止态 thumb 的底色必须不透明。** Chromium 把全透明 thumb 当作不存在，此后 `:hover` 永远不生效；所以静止态用 `--scrollbar-thumb`（主题里一档 14%~16% 的黑/白）着色，只在容器悬停时换 `--scrollbar-thumb-hover`。
- **颜色切换不要靠 `opacity` 动效。** `-webkit-scrollbar-thumb` 的 `background-color` 过渡在 Chromium 各版本上不一致；Firefox 的 `scrollbar-color` 根本不能过渡，只能硬切——这是接受的降级。
- **Firefox 的 `scrollbar-color` 会级联给后代可滚动元素。** 所以聊天容器用 `wide` 时，markdown 代码块必须把 4px 常显值钉死，否则会继承「悬停才显」并带错轨道色。
- **焦点环由全局 `:focus-visible` 提供，指针操作不显形。** `:focus` 仍然清掉 outline，但 `:focus-visible` 统一画 `--focus-ring-width`（2px）`--focus-ring-color`（浅 `#4176e6` / 深 `#7aaaff`）并留 2px 偏移。表单控件（`input`/`textarea`/`select`）从这条规则里排除，它们各自用边框变色或 `box-shadow` 环表达焦点（`.show-file-carousel:focus-visible`、`.timepicker-wheel:focus-visible`、`.scheduler-text-input:focus`、设置弹窗的输入皮肤），两套环叠在一起会糊成双描边。新增的可点击元素不需要自己写焦点样式，除非它要画在圆角容器内部。
- **聊天区永远不出现横向滚动条。** 一个轴 `auto` + 另一个轴 `visible` 会被浏览器算成双 `auto`，聊天里一个宽元素（长路径的表格单元格、不自适应的内嵌 SVG）就能把整栏顶歪；因此 `.markdown-body` 直接 `overflow-x: hidden`，换行与裁剪交给内部元素。
- **浮动卡片几何是四个锁在一起的值。** `--panel-padding` 10px / `--panel-gap` 8px / `--panel-gap-stack` 4px / `--panel-radius` 16px：改 gap 要同步 radius，否则圆角不是显紧就是显松。侧栏与右栏在浮动模式下把自己的 `margin` 串进同一段 `cubic-bezier(.25,1,.5,1)`，关闭时 gap 与宽度一起塌，不会留下一条孤儿 `--bg` 竖条。`flex-grow` 参与 normal ↔ expanded 过渡，是为了让内联的 32% 宽度仍然可插值。
- **应用底色与卡片底色是两个 token。** 外壳与 `html/body` 用 `--bg-app`（浅 `#f2f3f5` / 深 `#161618`），浮在它上面的面板、卡片、聊天区用 `--bg`；侧栏、输入底座等次级面用 `--bg-panel`，浮层（菜单、tooltip、toast、对话框）用 `--bg-elevated`。混用会让外壳与卡片同级，浮起关系就没了。
- **字体只有三个角色变量。** 组件消费 `--font-ui-stack` / `--font-mono-stack` / `--font-display-stack`（`:root` 定义栈，`@theme` 暴露 Tailwind 别名），不直接写平台字体栈。
- **Electron 的原生标题栏按钮画在应用自己让出的一条上。** 该条高度取 `env(titlebar-area-height)`（普通浏览器与无 overlay 的窗口为 0px），只作拖拽区、不绘制任何东西；这不是平台分叉，是浏览器特性。同样的理由让外壳的 `errorPage` 自带一条 `.drag` 区：服务没连上时应用还没渲染出自己的拖拽条，否则那个窗口拖不动。
- **全局 keyframes 的名字是跨文件契约。** `AudioPlayer`、`SessionItem`、`ToastCard`、`ThinkingPicker`、`TranslatePanel`、`TextSelectionToolbar`、`SaveButton`、`GrokBot` 以 inline style 引用这些名字，重命名等于静默废掉动画；`prefers-reduced-motion` 的抑制统一在全局声明，不在各组件各写一份。
- **两处第三方撞名必须由全局规则兜住。** Tailwind 生成的 `.table` 工具类与 Prism 的 markdown `.table` token 同名，会把源码摊成一列，所以有专门的复位类（聊天、文件预览、SkillConfig 预览共用）；Radix Tooltip 的 `data-radix-popper-content-wrapper` 默认可命中，会吞掉底下的 hover/click，全局把它及其子树置为 `pointer-events: none`，交互式 tooltip 用 `data-interactive-tooltip` 显式 opt-out。
- **CodeMirror 的内容层必须保持透明。** `drawSelection` 的选区层 z-index 是 -1（非 overlay 时），不透明背景会把整段选区一起藏掉；可见背景由 `.cm-editor` / `.cm-scroller` 提供。`::selection` 在 CodeMirror 内不生效（`drawSelection` 关掉了原生选区），所以在那层重放同一份 accent 水洗，且 `!important` 不能删——`oneDark` 主题在本文档之后注入且特异性更高。
- **Monaco 的 git gutter 用整行 `border-left` 装饰类。** 目的是贴近旧 Prism 渲染的观感，同时不去和 Monaco 自己的选中/当前行样式打架。

## Considered options

- **留在 CSS 注释里。** 这正是本次清理否决的形态（ADR-0040）：约束散在 89 个块里，只有读到那段样式才知道有这条规矩，而样式是会被重排的，注释却不会跟着走。
- **每条约束配一个测试。** 这些是浏览器行为与观感契约，vitest 驱动不了 Chromium 的滚动条实现，写出来的只会是对 CSS 文本的断言——比读 CSS 更脆。
- **全部删掉、只留代码。** 「透明 thumb 会被当成不存在」这类事实代码里完全看不出来，删掉等于把下一次踩坑的时间点往后推。

## Consequences

- 改滚动条、浮动卡片几何、CodeMirror 选区、全局 keyframes 之前先读本文；改动若推翻上面任何一条，同步改这一篇，而不是就地写注释。
- 本文与 `app/globals.css` 是两份载体：样式改了而这里没改，就是过期文档——但它至少是**一个**可检索的位置，不再散在 89 处。
- 新增的样式约束如果只是审美选择，不进本文；本文的门槛是「读代码读不出来」。
