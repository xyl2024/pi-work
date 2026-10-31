# Subagent toolsets must not require a user confirmation

A subagent child session has no UI attached to it: its `permission_request` events only reach a browser that has that exact child session open (and only while it is the selected session), and the parent's subagent sessions popover only reads the task rows. Before unattended permission tiers existed, a confirmation raised from a child therefore could not be answered: it waited out `dangerous_patterns.timeout_ms` and was then auto-denied, blocking the child for a long time to reach an outcome we already knew. That waiting failure mode is no longer the default. A subagent session now starts in `auto_deny` and a matched dangerous rule is denied immediately, with no gate and no waiting (ADR-0025).

We decided that a subagent profile must never depend on a confirmation prompt being answered: no child permission request is forwarded anywhere, and a dangerous-command rule matched inside a subagent session is denied immediately by default. `codegraph_build` init/index got the same hard denial (kept as a guard even though no current profile exposes that tool). Concretely: `codegraph_build` is excluded from every subagent profile, and `bash` (given to both `codebase_explorer` and `code_reviewer`) fast-denies on a matched rule unless the profile explicitly opts into full access (ADR-0025).

## Considered options

- **Forward child permission requests to the parent's UI.** Best UX, but needs child→parent event routing plus lifting the `activeSessionId` gate in `usePendingPermissions` that only renders the queue head of the selected session.
- **Keep waiting for the timeout.** Free, but that was the old failure mode: it burns the timeout per blocked command and holds one of the parallel subagent slots the whole time.

## Consequences

- A user cannot answer a blocked command coming from a subagent, even with that child session open in a tab. The child is expected to switch to a read-only alternative and say what it needed. The only way to let a matched rule run is to configure the profile as `full_access` before the session starts (ADR-0025); opening the child at runtime changes nothing.
- Any future subagent profile must be checkable against this rule: does every tool in the profile avoid interactive prompts, or run under a tier that never prompts (ADR-0025)? `tests/unit/subagent-profiles.test.ts` guards the current profiles.

## Update: profiles are user-configurable

Subagent profiles later became rows in `subagents.db`, editable in Settings →
Subagents (`lib/server/subagent-profiles.ts`). The seed for the built-ins
still honours this rule — `SUBAGENT_DEFAULT_CODEGRAPH_TOOL_IDS` excludes
`codegraph_build`, and both built-ins start from the read-only core plus shells
— but the rule is no longer enforced on *user-created* profiles: the editor
lets the user pick any tool. A profile that includes a shell keeps the original
failure mode by default: a matched dangerous rule is denied immediately rather
than waiting out a timeout, unless the profile is configured as `full_access`
(ADR-0025); it just is the user's explicit choice now. The guard test still
covers the default seed, which is the part this project controls.

The built-in `implementer` deliberately includes `edit`, `write` and `codemode`
so it can change the working tree in one session; none of those raise a
permission prompt, and its `bash` fast-denies on a matched dangerous rule by
default.
It also inherits the parent's system prompt verbatim by default.

## Update: unattended permission tiers

Subagent sessions now carry a per-profile `permission_mode` (ADR-0025). "Always
fast-deny" is therefore "fast-deny by default": `auto_deny` immediately denies a
matched dangerous rule with no gate and no session memo, while `full_access`
lets the command run. A profile does not get a `confirm` tier — no one is there
to answer — and self-protection blocks in both tiers. The invariants above still
hold: prompts are never forwarded to the parent, and the default for every new
or legacy profile is `auto_deny`.
