# Concern modules take their shape from the nature of the concern

`components/chat/ChatWindow.tsx` grew to 1842 lines holding fourteen unrelated concerns behind a 22-prop interface: auto-naming, the session notify binding, text selection, tool-call stats, the streaming projections, in-session search, replay, export, scroll follow, drag & drop, and the message timeline. None of them had a seam of its own, so the only way to reach a concern was to mount the whole chat window. Two failure modes were already visible: "which messages are visible, and where does a session entry index sit in that list" was hand-derived in four separate places (search jump, the render ref array, the tool-call jump map, and the per-message render guard), so any drift between them shows up as "the search hit jumps to the wrong message"; and the auto-naming ledger ("this session has already been named") lived in an instance ref, while one chat window is mounted per session tab — closing and reopening a tab reset the ledger and could name the same session twice.

ADR-0002 had already established the working shape for one of these concerns: `lib/shared/panelTabs.ts` is a pure registry plus a pure reducer, tested directly in `tests/unit/panel-tabs.test.ts`, with behaviour deliberately unchanged. This ADR generalizes that shape rather than inventing a second one.

We decided three rules that every extraction from the chat window — and later, from the shell — follows.

**1. A concern module takes its shape from the nature of the concern.**

- A concern whose core is *rules* (which messages are visible, what a search jump resolves to, whether auto-naming may run now) becomes a pure module in the shared layer — no React, no DOM, no client hooks, no server imports — with a thin client hook over it. (The deciding question was narrowed to *whether the concern's input is pure domain fact* by the 修订 at the end of this file: a rule-shaped concern whose input carries client-transport facts is a pure module in `lib/client` instead.)
- A concern whose core is *I/O or imperative DOM* (timers and requests, scroll positioning) becomes a client hook that receives its dependencies (refs, the active-tab flag, callbacks) as parameters. It never creates a ref or reads the environment itself.
- A concern gets a module-level store only when its state must be shared across session tabs. None of the chat-window concerns qualify.

**2. Refactors freeze behaviour.** A restructuring PR changes no visible behaviour, wording, or interaction. Issues discovered while moving code are recorded as findings, not fixed in the moving diff — a behaviour change and a 1000-line move in one diff makes "nothing broke" impossible to confirm by reading.

**3. No browser test infrastructure.** Rules are pushed down until they can be tested through the shared-layer seam with vitest. A hook that still contains an `if` means the rule has not been pushed down far enough; the remaining wiring — timers, requests, DOM calls, toasts — is verified by a manual checklist in the PR, with the uncovered parts stated rather than assumed.

## Considered options

- **Uniform shape: every concern becomes a client hook with `useState`.** The smallest convention to remember, and the fastest to write, but it leaves every rule inside React, so the seam stays where it is today: nothing can be tested without a browser.
- **Every concern becomes a module-level store with `useSyncExternalStore`, keyed by tab.** Uniform and easy to subscribe to, but it introduces cross-tab sharing where none is needed — exactly the surface that let the celebrate-dedupe set leak across sessions — and it does not by itself make any rule testable.
- **Add jsdom + testing-library and test the hooks directly.** Tests the wiring layer that rule 3 leaves uncovered, but it adds repo-wide infrastructure and tests past the interface instead of through it; a hook whose rules are already pure does not need a DOM to be trusted.
- **Extract the 400-line inline message renderer first, since it is the single largest block.** The biggest line-count win, but its seven maps and five callbacks are symptomatic of a missing view model, and designing that interface is its own decision; doing it inside a behaviour-frozen move would force the two to be settled at once.

## Consequences

- The seam is `lib/shared` pure modules plus `tests/unit/*.test.ts`, the seam ADR-0002 opened. There is deliberately no second seam, and no browser test infrastructure to maintain.
- Hook interfaces take their dependencies as parameters. They read nothing from the environment, which is what makes the wiring layer reviewable by reading a few lines rather than by running it.
- A rule that cannot be made pure is a signal that the module shape is wrong, not a reason to reach for jsdom.
- Behaviour-frozen restructuring leans on a per-PR manual checklist. The repository has no end-to-end suite to fall back on, and this ADR does not add one back.
- The auto-naming ledger is the one deliberate granularity change: it moves from an instance ref to a module-level, session-keyed ledger, because the per-tab granularity was demonstrably wrong (a session, not a tab, is named once).
- `useAgentSession`'s 45-key return interface, the convergence of the four "only the visible tab may publish into a global store" sites, and the message renderer's parameter shape are all out of scope here and tracked separately.

## 修订 2026-09-19（#78）：规则型的关切可以住在客户端层

规则 1 说「核心是规则的关切 ⇒ 纯 module 放共享层」。计划写入会话（`lib/client/plan-write-session.ts`）是一处**有意的宽松读法**：它仍然是一条规则型的关切——它比任何一条都更像「规则」——但它不住在共享层。

理由在**输入**那一侧。这台状态机的处境由客户端传输事实构成：「服务端回了 409、`code` 是 `missing`、`movedTo` 是那条路径」，承载它的是传输层抛出的 `PlanConflictError`；而共享层那份 `lib/shared/plans.ts` 是本项目与服务端共用的领域契约（808 行：文件名语法、时间锚点、分区、frontmatter 解析）。把状态机放进共享层，要么让共享层开始认识客户端的传输错误，要么让服务端 bundle 里多出一份它用不到的会话状态机。

判定的问句因此从「它的核心是不是规则」细化为「**它的输入是不是纯领域事实**」：

- 是（哪些消息可见、搜索跳转会落在哪、文件名与时间锚点、分区、自动命名账本）⇒ 共享层，服务端可能也读它；
- 否（输入里带着传输、I/O 或客户端会话的事实）⇒ **客户端层，但仍是纯 module**。

这条宽松读法不豁免规则 1 的实质，只挪动落点；落在客户端层的 module 仍须满足：

- 不 import React、DOM、`fetch`、任何服务端模块（只 import `lib/shared` 的类型与纯函数）；
- 没有自己的 store：一个面板、一个打开的弹窗，没有跨标签页共享面（ADR-0002 与规则 1 的第三条）；
- 判定与顺序都能在 `tests/unit` 里被直接驱动：`reducePlanWriteSession(state, intent)` 是纯归约器，执行待办的那段循环（`runPlanWriteEffects(effects, port, dispatch)`）照 `runTurn(spec, factory)` 的先例把依赖当参数收进来，因此接线层不需要 mock，也不需要浏览器。

规则 3 的口径不变：规则与顺序都被推到纯 module 与依赖袋 seam 之后，人工清单只剩 DOM 接线（焦点、`Esc`、遮罩、滚动、连按）。
