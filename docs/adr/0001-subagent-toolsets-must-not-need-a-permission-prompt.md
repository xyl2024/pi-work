# Subagent toolsets must not require a user confirmation

A subagent child session has no UI attached to it: its `permission_request` events only reach a browser that has that exact child session open (and only while it is the selected session), and the parent's spawn panel merely polls `/api/subagents/<id>/activity`. A confirmation raised from a child therefore cannot be answered — it waits out `dangerous_patterns.timeout_ms` (5 minutes by default) and is then auto-denied, blocking the child for minutes to reach an outcome we already know.

We decided that a subagent profile may only contain tools that never need a confirmation, and that every interactive gate refuses a subagent outright instead of prompting: a dangerous-command rule matched inside a subagent session is blocked immediately, and so is `codegraph_build` init/index (kept as a guard even though no current profile exposes that tool). Concretely: `codegraph_build` is excluded from every subagent profile, and `bash` (given to both `codebase_explorer` and `code_reviewer`) fast-denies on a matched rule.

## Considered options

- **Forward child permission requests to the parent's UI.** Best UX, but needs child→parent event routing plus lifting the `activeSessionId` gate in `usePendingPermissions` that only renders the queue head of the selected session.
- **Keep waiting for the timeout.** Free, but burns up to 5 minutes per blocked command and holds one of the parallel subagent slots the whole time.

## Consequences

- A user can no longer approve a blocked command coming from a subagent, even with that child session open in a tab. The child is expected to switch to a read-only alternative and say what it needed.
- Any future subagent profile must be checkable against this rule: does every tool in the profile avoid interactive prompts? `tests/unit/subagent-profiles.test.ts` guards the current profiles.
