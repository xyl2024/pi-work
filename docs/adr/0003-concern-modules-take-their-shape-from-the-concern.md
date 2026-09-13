# Concern modules take their shape from the nature of the concern

`components/chat/ChatWindow.tsx` grew to 1842 lines holding fourteen unrelated concerns behind a 22-prop interface: auto-naming, the session notify binding, text selection, tool-call stats, the streaming projections, in-session search, replay, export, scroll follow, drag & drop, and the message timeline. None of them had a seam of its own, so the only way to reach a concern was to mount the whole chat window. Two failure modes were already visible: "which messages are visible, and where does a session entry index sit in that list" was hand-derived in four separate places (search jump, the render ref array, the tool-call jump map, and the per-message render guard), so any drift between them shows up as "the search hit jumps to the wrong message"; and the auto-naming ledger ("this session has already been named") lived in an instance ref, while one chat window is mounted per session tab — closing and reopening a tab reset the ledger and could name the same session twice.

ADR-0002 had already established the working shape for one of these concerns: `lib/shared/panelTabs.ts` is a pure registry plus a pure reducer, tested directly in `tests/unit/panel-tabs.test.ts`, with behaviour deliberately unchanged. This ADR generalizes that shape rather than inventing a second one.

We decided three rules that every extraction from the chat window — and later, from the shell — follows.

**1. A concern module takes its shape from the nature of the concern.**

- A concern whose core is *rules* (which messages are visible, what a search jump resolves to, whether auto-naming may run now) becomes a pure module in the shared layer — no React, no DOM, no client hooks, no server imports — with a thin client hook over it.
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
