# 输入区的规则住在纯 reducer 里，视图只做投影

聊天输入区重写后，斜杠查询、`@` 提及、输入历史、芯片插入与删除、光标移动、撤销/重做、发送判定这些规则全部收进 `lib/client/composer/` 的纯模块：`reduceComposerKey(state, input)` 吃一份不可变文档、逻辑光标和按键，返回新状态与一个 `effect` 值。`Composer.tsx` 不再自己判断「这个键该不该删芯片」或「现在能不能发送」，只把 DOM 事件翻译成 `ComposerKeyInput`，再把返回的状态投影回 `contenteditable`，并执行 `send`、`thinking` 这类效果。

这是 ADR-0003 修订里「规则型关切、输入是客户端传输事实 ⇒ 纯模块放 `lib/client`」的一次落地。输入框的规则不是纯领域事实（它认识 DOM 选区、输入法合成、浏览器按键），所以不放进 `lib/shared`；但它也完全不碰 React 与 DOM，因此仍能被 `tests/unit` 直接驱动。

## 决策

1. **规则住在纯 reducer。** 文档是唯一真值，光标是逻辑偏移，DOM 只是投影。新增行为先问「它能不能写成 `reduceComposerKey` 的一个分支或一个纯函数」，不能才退到视图层。视图层里只允许出现接线：读选区、写选区、调用 `preventDefault`、请求动画帧、执行效果。
2. **副作用是值。** reducer 不发送消息、不切换思考级别、不写 DOM；它返回 `"none" | "edit" | "send" | "history-prev" | "history-next" | { type: "thinking", level }`。要不要发送是 reducer 的结论，发送本身由视图执行。
3. **视图是投影。** 每次状态变化都从文档重新生成 DOM 与光标，不反向信任浏览器留下的内容。唯一例外是输入法合成：合成期间冻结模型，`compositionend` 时先把 DOM 同步进模型，再一次性投影回去；合成期间完成的图片编码也排队到此时插入，避免投影擦掉正在拼写的文字。
4. **只有一处浏览器测试例外。** 规则由纯模块测试覆盖；DOM 适配层只保留一个 jsdom 文件级例外，用来钉住 `Selection ↔ 逻辑偏移` 与「合成期间模型不更新」。不引入 testing-library，也不改 vitest 的 include 配置。渲染结构、样式与 `field-sizing` 仍走人工清单。

## Considered Options

- **继续把规则留在组件与 hook 里。** 每次改行为都要手点验证，`getSlashQuery` / `getMentionQuery` 这类规则会继续零覆盖；重写前已经因此付过代价。
- **引入 contenteditable 编辑框架（ProseMirror / Lexical 等）。** 它们的模型与 schema 会接管整条文档流，但本项目只需要「文本 + 三种芯片」这一种窄文档，接入成本与依赖体积都不划算，也会让发送序列化多一层映射。
- **用浏览器原生 undo。** contenteditable 的原生撤销栈会与模型互相踩；撤销栈只能自己维护成 `past` / `future` 两份快照。
- **把芯片删除按钮做成常驻控件。** 见下。

## Consequences

- 新增一个按键语义时，先加 reducer 分支与 `tests/unit/composer-*.test.ts`，再加视图接线；测试失败能直接定位到规则，而不是渲染。
- `Composer.tsx` 仍是最大的接线文件。图片编码、对象 URL 生命周期、灯箱条目与插入/移除已抽到 `useComposerImages`；34 个 prop 的接口与底部工具栏暂不动，属于后续独立的收敛项。
- **X 按钮的取舍。** 原始 spec 写的是「不提供 X 按钮」，理由是芯片边界按一次 `Backspace` 就能删除。后续 ticket 05 明确要求图片芯片悬停出现移除按钮，并且已经落地。这条更晚的工单覆盖 spec：图片芯片保留悬停移除按钮，技能与文件芯片仍不提供常驻删除控件；两者都仍然支持键盘删除。
- 输入法合成期间的模型冻结成为硬约定：任何在合成期间写模型或重投影 DOM 的改动都会重新引入「拼音被擦掉」的缺陷，必须同时更新那条 jsdom 例外测试。
