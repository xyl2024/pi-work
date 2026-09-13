# Domain 文档

本仓库的工程类 skill 在探索代码库时，应这样消费领域文档。

## 探索之前先读这些

- 根目录的 **`CONTEXT.md`**，或
- 根目录的 **`CONTEXT-MAP.md`**（如果存在）：它指向每个上下文各一个 `CONTEXT.md`，读所有与当前主题相关的那些。
- **`docs/adr/`**：读与即将改动的区域相关的 ADR。多上下文仓库中，还要看 `src/<context>/docs/adr/` 里的上下文级决策。

如果这些文件不存在，**静默继续**。不要指出它们缺失，也不要主动建议创建。`/domain-modeling` skill（可通过 `/grill-with-docs` 和 `/improve-codebase-architecture` 到达）会在术语或决策真正确定时按需创建它们。

## 文件结构

单上下文仓库（绝大多数仓库）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文相关决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用词表中的词汇

当你的产出要命名某个领域概念时（issue 标题、重构提案、假设、测试名），使用 `CONTEXT.md` 中定义的术语，不要漂移到词表明确排除的同义词。

如果需要的概念还不在词表里，这是一个信号：要么你在发明项目并不使用的语言（重新考虑），要么存在真实的缺口（记给 `/domain-modeling`）。

## 标出 ADR 冲突

如果你的产出与既有 ADR 相矛盾，显式指出，而不是悄悄覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重开因为……_
