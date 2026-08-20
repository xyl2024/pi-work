# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Never Destroy User Data

**Treat any file in a user data directory as irreplaceable until proven otherwise.**

A single careless command can wipe data that has no backup, is not in git, and cannot be recovered. This is not a theoretical risk — it has happened here.

### The hard rules

- **NEVER** run overwrite commands (`cat > file`, `echo > file`, `> file`, `tee file`, `sed -i`, `python3 -c "open(p,'w').write(...)"`) on any file in `~/.pi-work/`, `~/.pi/`, `~/.config/...`, or any other user data directory. These truncate the file before the new content is written; if the new content is malformed, the original is gone with no undo.
- **NEVER** use shell heredoc (`<< EOF ... EOF`) to "create a small test file" at a path that overlaps with a real file. Heredoc + `>` overwrites silently.
- **For tests that need to touch user data**: copy the file to `/tmp/` first, work on the copy, and never write back to the original path. If a test must hit the real file, drive it through the app's own API (POST/PATCH/DELETE) — those code paths are tested and validated.
- **For JSON modification**: use `jq` (in-place with `jq ... file.json > tmp && mv tmp file.json`) or run a Node script. Do not use raw shell redirection.
- **Before any write to user data**: take a backup with `cp file file.bak.$(date +%s)` first. If something goes wrong, restore the backup.

### Why this is so dangerous in this project specifically

- The user todo list is stored in `~/.pi-work/todos.db` (SQLite via `better-sqlite3`). The legacy `todos.json` was renamed to `todos.json.migrated.<ts>` on first DB read — it is **not** deleted and can be inspected with `cat`. To roll back: run `npx tsx scripts/todos-restore.ts` (writes a fresh `todos.json` from the DB; if `--out` already exists it is renamed to `<out>.restored.<ts>` first, matching the rename-not-delete migration pattern).
- The `cat > ~/.pi-work/todos.db` (or `todos.json`) idiom is the kind of thing that looks safe in a one-liner test script but truncates the file immediately. If the heredoc body is wrong, the file is `0 bytes` and unrecoverable.
- Other irreplaceable user data in this project: `~/.pi-work/todo_images/`, `~/.pi-work/workspace/`, `~/.pi-work/config.yaml`, `~/.pi-work/scheduler.db`, `~/.pi-work/favorites.json`, `~/.pi-work/agent-todo/`, `~/.pi/agent/sessions/`, `~/.pi/agent/models.json`, `~/.pi-work/pinned.json`, `~/.pi-work/todo-tools.json`.
- The agent todo state lives in `~/.pi-work/agent-todo/<sessionId>.jsonl` (append-only snapshots). The current state is the last parsed line; truncating the file wipes it instantly with no DB backup.

### If a write goes wrong

1. **Stop.** Do not run more commands. Every subsequent write makes recovery harder.
2. Check if the user's browser app is still open and the React state still has the data. If so, do **not** let them refresh. Have them copy the state out via DevTools (`copy(JSON.stringify(window))` in Console, or React DevTools → TodoProvider state) before anything else.
3. Look for backups in `/tmp/`, `~/.*.bak`, `~/.local/share/Trash/`, the project's `.cache/`, or the running server's memory (`/proc/<pid>/maps` → `heap` region).
4. Only after exhausting recovery options, tell the user what was lost and what remains.

**The cost of "I'll just write a small test file to that path" can be the user's entire data. Don't take that bet.**

## 6. Don't Touch the Production Environment Without Permission

**Production build/restart is a user-initiated decision — never an autonomous side effect.**

The user's terminal may already be running `run_pi_web.sh`, a systemd user unit, or some other long-lived process serving traffic. A surprise rebuild or restart is disruptive, slow, and often irreversible mid-session. Even if the server "looks down," do not start it back up on your own.

### The hard rules

- **NEVER** run `npm run build` on the user's behalf. The dev loop is `npm run dev`; production builds are deliberate (`run_pi_web.sh` consumes a fresh bundle, and `next build` also pollutes `.next/` in a way that breaks `npm run dev`).
- **NEVER** kill, restart, start, or otherwise touch the production server process — `run_pi_web.sh`, systemd user units (`systemctl --user ...`), or anything else bound to a shared port. This includes `pkill` / `kill` / `killall` against a server PID, even if it "looks stuck."
- **NEVER** run `scripts/deploy-systemd-user.sh`, launch the Electron shell on the user's behalf, or publish a build to a shared location.
- **NEVER** treat "the prod server is responding on port X" as a green light to take a side action. Read-only probing is fine; anything that mutates the running stack is not.

If a task seems to call for one of these — even a "small" rebuild that "feels safe" — stop, name what you want to run and why, and wait for an explicit OK. The user is the only one who knows whether now is the moment to interrupt the running service.

# Pi Work

Web UI for the pi coding agent. The product is called "Pi Work" (renamed from "Pi Agent Web"). The package is `@xyl2024/pi-work`.

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`
Lint (targeted — fast, ~4s): `node_modules/.bin/eslint <files-you-changed>`
Lint (full — use before commit / in CI): `npm run lint` (= `eslint .`)

`tsc --noEmit` is mandatory after every change. Targeted `eslint <files>` is
fast enough to run alongside it; full `npm run lint` lints the whole 1100+-file
tree and surfaces a long tail of pre-existing warnings, so skip it locally
unless you want to gate on it. The `next lint` subcommand was removed in Next 16.
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

## npm install gotchas

### `NODE_ENV=production` silently skips devDependencies

Any shell spawned from the running production server (check
`echo $NODE_ENV`; `npm_lifecycle_script=next start ...` in the env is a
smoking gun) has `NODE_ENV=production`, which makes `npm install` default to
`--omit=dev`. Result: devDependencies (`typescript`, `@types/*`, …) are never
installed, and npm reports **"up to date"** while installing nothing.

Symptoms:
- `node_modules/.bin/tsc` doesn't exist, or `tsc --noEmit` floods with
  `TS7016: Could not find a declaration file for module 'js-yaml'/'ws'/...`
  for packages that ARE in package.json/package-lock.json.
- `npm install <devDep>` says "up to date" but the folder never appears.

Fix: `npm install --include=dev` (or `unset NODE_ENV` first).

### npm registry CDN flakes on some tarballs

`registry.npmjs.org` metadata responds fine but certain tarballs (e.g.
`typescript-5.9.3.tgz`) hang on direct connection, while other packages
download fine — the official CDN is unreliable from this network. If an
install hangs or fails on tarball fetch, retry with the mirror, which is a
command-line flag and does NOT touch `.npmrc`:

```bash
npm install --registry=https://registry.npmmirror.com
```

### npm believes a partial node_modules is complete

If `node_modules` is missing packages but npm keeps saying "up to date", the
hidden `node_modules/.package-lock.json` (npm's internal install state) is
out of sync. Delete it to force a real reconciliation:

```bash
rm -f node_modules/.package-lock.json
npm install --include=dev --registry=https://registry.npmmirror.com
```

The two gotchas above compound: the 2026-08 node_modules breakage was exactly
this — production-inherited env + flaky official CDN — and the combo command
above fixed it (added 278 packages).

## Production startup

For long-running local use, do not use `npm run dev`. After source changes,
build the production bundle:

```bash
npm run build
```

Start the production server with:

```bash
/home/alone/.xyl_scripts/run_pi_web.sh
```

## Electron shell (optional desktop wrapper)

`electron-shell/` ships a small Electron app that embeds the running Pi Work
in an `<iframe>` with a custom macOS-style traffic-light titlebar. It expects
the server on `PI_PORT` (default `14514`) and connects to `http://localhost:<port>`.

- The iframe must declare `allow="clipboard-read; clipboard-write"` or the
  Chromium Permissions-Policy will silently block every
  `navigator.clipboard.writeText()` call inside Pi Work.
- DevTools toggle: F12 / Ctrl+Shift+I (handled in `titlebar.js`).
- Tray icon + global shortcut + `--hidden` flag are part of the Phase 1 scope
  in `main.js`; see that file for current behavior.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files directly via `lib/server/session-reader.ts` — no AgentSession created.
**Sending a message**: `startRpcSession()` in `lib/server/rpc-manager.ts` creates an AgentSession in-process.

### Process startup

`instrumentation.ts` runs once per server boot. It lazily imports the WeChat
monitor bootstrap (`@/lib/server/wechat/startup`), the scheduler loop
bootstrap (`@/lib/server/scheduler/startup`), the RSS poll-loop bootstrap
(`@/lib/server/rss/startup`), and the terminal WebSocket server bootstrap
(`@/lib/server/terminal/startup`), so a logged-in WeChat account, any
enabled cron tasks, any configured RSS feeds, and the terminal panel are
serviced as soon as the server is up — no need to load any page first.

### Right-panel architecture

The right side of `AppShell` hosts a stack of tool panels, each backed by a
module-scoped store using `useSyncExternalStore`:

- `sessionUiStore` — branch leaf (`branchTree`/`ActiveLeafId`), `systemPrompt`, `sessionStats`, `contextUsage`. Owned by `useAgentSession`, read by `AppShell`. Imperative session controls (model/thinking/tools/compact) are bridged to `CommandPalette` ⌘K via the separate `useAgentControls()` hook, **not** part of this store's snapshot.
- `toolCallStatsStore` — per-turn tool call statistics, owned by `useAgentSession`, read by the vertical button + `ToolCallStatsPanel`.

The store pattern eliminates the previous "5 separate `onXxxChange` props +
matching `useState` in AppShell" dance and makes state survive `ChatWindow`
remounts (no top-bar flash on session switches).

### Custom command palette

`lib/client/commands.tsx` defines a typed command registry (each command has an SVG
icon, keybinding, predicate, and run function). `CommandPalette` (⌘K,
Raycast-style, in `components/app-shell/`) reads + dispatches agent controls
registered by the active `ChatWindow` via `setAgentControls()`. New
agent-facing actions belong here rather than as ad-hoc top-bar buttons.

### Scheduler

Cron-based task runner in `lib/server/scheduler/`. The loop (self-rescheduling
`setTimeout`, no `setInterval` drift) is started by `lib/server/scheduler/startup.ts`
from `instrumentation.ts`. Every CRUD on `/api/scheduled-tasks` calls
`reschedule()` so the loop picks up changes immediately. Each run cold-starts
a fresh pi session (the scheduler never shares a wrapper with a user's open
session) and records `{ running, success, error, timeout }` outcomes to
`scheduled_task_runs`.

### Permission dialog

`PermissionProvider` (in `hooks/usePendingPermissions.tsx`) listens for
inbound permission requests from the SSE stream and renders a portal'd
`PermissionDialog` with **Esc → deny**, **Enter → allow once**, and
backdrop-click → deny as the safe defaults. Decisions are POSTed back to the
session; queue is mirrored in a `useRef` so async handlers always see the
latest list when removing by `toolCallId`.

### Custom agent tools

`lib/server/rpc-manager.ts` registers these as `customTools` on `createAgentSession`:

- `user_todos_list` / `user_todo_description` — read-only todo queries against `~/.pi-work/todos.db` (`lib/server/user-todo/tools.ts`, gated by `~/.pi-work/todo-tools.json`). The first returns a lightweight summary filterable by `status` / `tags` / `create_time_window` / `due_time_window`; the second fetches full description + image URLs by id. Set `PI_WORK_PUBLIC_BASE_URL` to control the image origin in the second tool's output.
- `show_media` — inline-render one or more **multimedia** files (image / video / audio) below the tool call in chat (`lib/server/show-file-tool.ts` + `lib/shared/show-file-tool-types.ts`). Path validation reuses `lib/server/file-access.ts` (same allowed roots as `/api/files`). The tool rejects PDF / Markdown / HTML / plain text / binary paths — use the right-hand FileViewer for those. The legacy alias `show_file` is still recognised by the derive layer (Session Library) and config (`~/.pi-work/config.yaml`) for backward compatibility.
- `agent_todo` — single-tool action-dispatched (`create | update | list | delete | clear`); persisted per-session to `~/.pi-work/agent-todo/<sessionId>.jsonl` as append-only snapshots (`lib/server/agent-todo-tool/store.ts`); pure reducer/types/response-envelope live in `lib/shared/agent-todo-tool/`. Full design in `docs/agent-todo/`.

Server-only modules under `lib/server/` import `@earendil-works/pi-coding-agent`, which transitively pulls in `child_process` and other Node modules. **Client code must import types/constants from `lib/shared/` instead** — see the `IMPORTANT` comment at the top of each tool file. The full layering rule is documented in the "Import boundaries" section below.

---

## Import boundaries (`lib/` three-layer rule)

The `lib/` tree is split into three layers with a one-way dependency
direction. Each layer has one job; the direction is enforced by review
(no ESLint rule yet, but the rule is non-negotiable):

```
lib/client/  ──depends on──▶  lib/shared/
                                  ▲
lib/server/  ──depends on──▶  lib/shared/
```

- **`lib/shared/`** — types, pure functions, and any data that must be
  importable from both sides (`types.ts`, `normalize.ts`, `description-sanitize.ts`,
  `i18n-dict/`, `right-bar.ts`, `agent-todo-tool/{reducer,types,response-envelope}.ts`,
  `config-types.ts`, …). **No `node:*` imports, no `@earendil-works/pi-*`,
  no `fs`/`better-sqlite3`/`js-yaml`/`simple-git`/etc.** Adding a server-only
  dependency here pulls the SDK into every client bundle and is the kind of
  mistake this layer exists to prevent.
- **`lib/client/`** — runtime UI helpers and browser-only state
  (`agent-client.ts`, `commands.tsx`, `shallowEqual.ts`, `git-status-store.ts`,
  `grokbot-store.ts`, `canvas-files-store.ts`, `file-icon-map.ts`,
  `user-todo/image-upload.ts`, …). Allowed to import `react`, browser APIs,
  and anything in `lib/shared/`. **Never import from `lib/server/`** — that
  would put Node-only modules on the client.
- **`lib/server/`** — everything that touches the filesystem, the SQLite
  databases, or the pi SDK (`rpc-manager.ts`, `session-reader.ts`,
  `config.ts`, `db.ts`, `file-access.ts`, `show-file-tool.ts`,
  `user-todo/tools.ts`, `scheduler/`, `rss/`, `wechat/`, `terminal/`, …).
  Allowed to import from `lib/shared/` and `lib/client/` only when the value
  is pure and side-effect-free (rare — usually prefer `lib/shared/`).

Conventions for cross-layer exposure:
- A `lib/server/foo.ts` that needs to be used from a `"use client"` file
  must split its public surface into `lib/shared/foo-types.ts` (or co-locate
  as `lib/server/foo-types.ts` and re-export through `lib/shared/`).
- `import type { Foo } from "@/lib/shared/..."` is always safe from the
  client side; **plain `import` from `lib/server/`** is never safe even if
  TypeScript erases it at runtime, because Next.js still walks the module
  graph to decide client vs server boundaries.
- The `next.config.ts` `serverExternalPackages` list covers
  `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `better-sqlite3`,
  `node-pty`, `ws`. Any new server-only dependency must be added there.

`hooks/` is allowed to import from any of the three layers (hooks run on
the client). `components/` is allowed to import from `lib/shared/` and
`lib/client/`; any `lib/server/` import from a component is a bug.

---

## File Map

The `app/` URL topology is unchanged (Next.js requires `route.ts` at a fixed path) — only the body of each handler references the new `lib/server/` and `lib/shared/` paths. `components/`, `lib/`, and `hooks/` follow the layered layout described above.

```
app/api/
  agent/{new,[id],[id]/events,[id]/agent-todo,tools}/route.ts
                                  new session + RPC + SSE + agent_todo read + tool catalog
  agent-settings/retry/route.ts   retry policy for rate-limited agent calls
  append-system/route.ts          GET/PUT ~/.pi/agent/APPEND_SYSTEM.md
  auth/{providers,all-providers,login/[provider],logout/[provider],api-key/[provider]}/route.ts
                                  OAuth + API-key provider flows
  create-space/route.ts           POST mkdir ~/.pi-work/workspace/<dir>
  default-cwd/route.ts            POST ensure ~/.pi-work/workspace/pi-cwd-default
  exchange-rate/route.ts          currency conversion helper for TokensPanel
  favorites/route.ts              GET/PUT ~/.pi-work/favorites.json
  files/{route,handler.ts,[...path]/route}.ts
                                  list/read/watch + write/create/rename/delete (handler.ts holds shared logic)
  git/{route,diff/route}.ts       git status, diff, log for the sidebar badge
  home/route.ts                   GET { home } homedir
  inbox/{messages,messages/[id],test}/route.ts
                                  inbox CRUD + test endpoint
  llm-audit/{calls,calls/[id],models,sessions,totals}/route.ts
                                  LLM call audit log queries
  models/{route,models-config/route}.ts
                                  list models + edit ~/.pi/agent/models.json
  pinned-cwds/route.ts            pinned project list
  profile/{route,avatar/route}.ts user profile + avatar
  prompts/route.ts                slash-command prompt templates
  rss/{feeds,feeds/[id],feeds/[id]/articles,articles/[id],articles/mark-all-read,fetch}/route.ts
                                  RSS feed + article CRUD
  scheduled-tasks/{route,[id]/run,[id]/runs,runs/[runId]}/route.ts
                                  cron tasks + run history
  sessions/{route,search,[id],[id]/context,[id]/search,[id]/auto-name,[id]/export,[id]/info,running}/route.ts
                                  session JSONL browsing, search, leaf context
  settings/route.ts               GET/PUT ~/.pi-work/config.yaml
  skills/{route,detail,install,search}/route.ts
                                  skill install + marketplace search
  slash-commands/route.ts         aggregated slash commands for a cwd
  tags/{route,color/route}.ts     rename/remove + color
  terminal/route.ts               terminal panel proxy
  todo-images/{route,[filename]/route}.ts
                                  upload + serve todo images
  todo-tools/route.ts             enabled-todo-tool config
  todos/{route,[id]/export/route}.ts
                                  user-todo CRUD + zip export
  token-audit/{calls,data,summary}/route.ts
                                  token consumption audit
  translate/route.ts              in-memory LLM call, no disk
  weixin/{login,login/verify-code,logout,status,contacts,test-send,inbound,workspace}/route.ts
                                  WeChat login + send + inbound push
  workspaces/route.ts             workspace listing

lib/client/                       browser-only state + UI helpers
  agent-client.ts                 sendAgentCommand() — single fetch helper used by hooks
  canvas-files-store.ts           IndexedDB storage for Excalidraw image dataURLs (with orphan GC)
  commands.tsx                    command-palette registry + AgentControls bridge
  export-message-card.ts          export a chat turn as a shareable card
  file-icon-map.ts                name → icon-id map for FileIcons (auto-generated)
  git-status-store.ts             module-scoped store of git status per cwd
  grokbot-store.ts                module-scoped GrokBot conversation state
  grokbot-data.ts                 seed phrases + persona data for GrokBot
  icon-paths.ts                   maps icon-id → /file-icons/*.svg URL
  rough.ts                        sketchy canvas renderer adapter
  shallowEqual.ts                 content-equality guard used by every useSyncExternalStore store
  user-todo/image-upload.ts       browser-side image upload + compression

lib/shared/                       pure types + browser/server shared
  agent-settings-types.ts         client-safe type for ~/.pi/agent/settings.json
  agent-todo-tool/                reducer.ts (pure) + types.ts + response-envelope.ts (no SDK)
  ask-user-questions-tool-types.ts tool name constant + schema
  buildConversationTree.ts        turn tree builder (pure)
  completion-note.ts              completion summary helpers
  config-types.ts                 PiWorkConfig + custom-tool / right-bar / typewriter types
  conversationTreeLayout.ts       layout math for ConversationTreeCard
  description-sanitize.ts         single DOMPurify config for todo descriptions
  extractCardText.ts              extract shareable text from a chat turn
  file-name.ts                    validateFileName() for create/rename routes
  file-paths.ts                   path normalization + /api/files URL encoding
  file-viewer-limits.ts           allowed file viewers + size caps (mirror of config)
  git-diff-types.ts               parsed git diff types
  git-line-marks.ts               map a diff hunk → line marks
  i18n-dict/                      en/zh dictionary split by feature
    index.ts + common.ts          barrel + shared phrases
    {chat,settings,rss,scheduler,sessions,todos,files,models,permissions,profile,
     prompts,media,renderers,right-panels,wechat,grokbot,inbox,terminal,
     commands,starter-prompts,ask-user-questions}.ts
  inbox-schema.ts                 inbox row schema (shared by store + UI)
  json-parser.ts                  tolerant JSON parser for the JSON panel
  llm-audit-types.ts              LLM audit row types
  message-display.ts              pick display variant for an AgentMessage
  normalize.ts                    normalizeToolCalls() — field name mismatch bridge
  right-bar.ts                    RightBarButtonId + RightSideBarConfig + visibility predicate
  rss/{schema,sanitize}.ts        RSS row types + HTML sanitization
  session-library-derive.ts       derive SessionLibraryEntry from session files
  show-file-tool-types.ts         tool name constant + supported media types
  slash-commands.ts               parse "/foo" out of an input string
  thinking-level-utils.ts         pickClosestAvailableThinkingLevel / pickHighestAvailable…
  token-audit-types.ts            token audit row types
  translate.ts                    translate prompts + language list (server + client)
  types.ts                        shared frontend types (AgentMessage, SessionEntry, etc.)
  typewriter-phrases.ts          typewriter effect phrases
  user-todo/{color-presets,images-utils}.ts
                                  todo palette + image helpers
  wechat/types.ts                 WeChat row types

lib/server/                       fs / SQLite / pi SDK
  agent-settings.ts               read/write ~/.pi/agent/settings.json
  agent-todo-tool/{store,tool}.ts per-session JSONL persistence + pi customTool orchestrator
  ask-user-questions-tool.ts      pi customTool for the agent's ask_user_questions flow
  config.ts                       read/write ~/.pi-work/config.yaml
  custom-tools-config.ts          read enabled custom-tool flags from config
  dangerous-patterns.ts           compile + cache regex rules from config.dangerous_patterns
  db.ts                           SQLite handle for ~/.pi-work/todos.db (+ JSON→DB migration)
  file-access.ts                  shared allowed-roots logic for /api/files + show_media tool
  git-diff.ts                     git diff parser (uses simple-git)
  hour-series.ts                  bucketing for usage charts
  http-proxy.ts                   proxyFetch core: server-side fetch with size + timeout guards
  inbox-{db,store}.ts             inbox SQLite handle + CRUD
  json-array-store.ts             read/write a JSON file containing a string array
  llm-audit.ts + llm-audit-db.ts  LLM call audit recording + queries
  llm-direct.ts                   one-shot LLM call (translate, exchange rate)
  logger.ts                       structured logger used by every route + lib file
  npx.ts                          helpers to run `npm` / `npx` from the server (skill install)
  pi-types.ts                     narrowed shapes for the pi SDK objects we touch
  profile-store.ts                ~/.pi-work/profile.json + avatar upload
  rpc-manager.ts                  AgentSessionWrapper + startRpcSession + customTools registration
  rss/{db,loop,startup,store}.ts  RSS feeds SQLite + self-rescheduling poll loop + bootstrap
  scheduler/{db,loop,runner,startup,store}.ts
                                  cron tasks + self-rescheduling loop + bootstrap
  session-export/pi-html.ts       export a session to standalone HTML
  session-reader.ts               parse .jsonl; buildSessionContext, buildTree, path cache
  show-file-tool.ts               pi customTool for inline file rendering
  terminal/{server,startup}.ts    node-pty WebSocket server + bootstrap
  token-audit-db.ts + token-audit-store.ts
                                  token consumption audit
  user-todo/{db,store,tools,tools-config,tools-payloads,tools-url}.ts
                                  todo SQLite + CRUD + pi customTools
  wechat/{api,inbound,index,monitor,monitor-lock,qr,sessions-log,startup,state}.ts
                                  WeChat client + inbound monitor + state + bootstrap

components/
  app-shell/
    AppShell.tsx                  layout + URL state + tab mgmt + right-panel stack
    CommandPalette.tsx            ⌘K Raycast-style palette (reads commands + session results)
  chat/
    ChatWindow.tsx + ChatInput.tsx + MessageView.tsx
                                  chat canvas: message list, input bar, per-message renderer
    AskUserQuestionsPanel.tsx + ask-user-questions-panel/
                                  modal + question card when the agent asks the user
    AttachmentList.tsx + PromptPreview.tsx + ReadFileChips.tsx
                                  file/image chips, prompt preview, read-tool result chips
    CompactionDivider.tsx + ContextUsageBar.tsx
                                  visual markers for compacted segments + token-usage bar
    ModelPicker.tsx + ThinkingPicker.tsx + MoreMenu.tsx
                                  model/thinking popovers + overflow menu
    PermissionDialog.tsx          portal'd permission prompt (Esc/Enter/backdrop-click defaults)
    ReplayBar.tsx                 replay controls (rewind/step through earlier turns)
    SlashCommandHint.tsx + SlashCommandMenu.tsx
                                  "/foo" autocomplete
    ToolsDropdownPanel.tsx        4-row tools popover (Off / Full / Read only / Custom ▶)
    chat-input/                   BottomToolbar + constants + types + hooks/{useImageAttachments,
                                  useInputHistory,useSlashMenu,useToolsDropdown,useTypewriterPhrases}
    chat-window/                  NewSessionPresets + ProcessDetailsGroup + utils
    message-view/                 AssistantMessageView + UserMessageView + blocks + context + utils
  files/
    FileViewer.tsx                thin entry (re-exports files/file-viewer/FileViewer)
    file-viewer/                  Audio/Image/Pdf/Text/Video/Diff viewers + VirtualizedCodeLines + utils
    FileExplorer.tsx + FileSearchBar.tsx + FileGitBadge.tsx + FileIcons.tsx
                                  sidebar file tree + search + git status badge + icon set
    AudioPlayer.tsx               audio file viewer (vinyl-disc aesthetic, 0.5x–2x speed)
    CodeBlock.tsx                 shared syntax-highlighted code block (Prism, copy, line numbers)
    ImageLightbox.tsx             image preview overlay
    MermaidBlock.tsx + SvgBlock.tsx + EchartsBlock.tsx + EchartsChart.tsx
                                  shared media renderers reused by MessageView
  grokbot/
    GrokBot.tsx + GrokBotLab.tsx + GrokBotStage.tsx
                                  GrokBot persona playground (lab canvas + chat stage)
  inbox/
    InboxBell.tsx + InboxMessageRow.tsx + InboxModal.tsx
                                  cross-module inbox UI
  panels/
    CanvasPanel.tsx + CanvasPanelInner.tsx
                                  Excalidraw whiteboard (dynamic import, IndexedDB-backed)
    GitDiffPanel.tsx              right-panel tab: git diff viewer
    JsonPanel.tsx + JsonTreeView.tsx
                                  right-panel tab: JSON editor + tree view
    LlmAuditPanel.tsx             right-panel tab: LLM call audit log
    TerminalPanel.tsx             right-panel tab: node-pty terminal (WS client)
    TokensPanel.tsx               right-panel tab: token-usage chart
    ToolCallStatsPanel.tsx        right-panel tab: per-turn tool-call stats
    TranslatePanel.tsx            right-panel tab: target-language picker + LLM call
    right-bar/                    RightBarButton + RightBarColumn + desc + icons
  rss/
    RssPanel.tsx                  thin entry (re-exports rss/*)
    ArticlesView.tsx + FeedsView.tsx + ReaderView.tsx + RssHeaderBar.tsx
                                  right-panel RSS feeds/articles/read-state UI
    relativeTime.ts + styles.ts   helpers + styled-components-style sheet
  scheduler/
    SchedulerModal.tsx + index.ts thin entry + modal opened from the avatar menu
    CronBuilder.tsx + CronHumanizer.tsx
                                  cron expression builder + humanizer
    TaskConfigTab/TaskListSidebar/TaskOverviewTab/TaskPromptTab/TaskRunsTab/
    TaskDetail/TaskFormModal      per-tab bodies
    icons.tsx + NumberStepper.tsx + StatusBadge.tsx + styles.ts + types.ts + useNow.ts + utils.ts
                                  shared bits
  sessions/
    SessionSidebar.tsx + SessionItem.tsx
                                  session tree (left sidebar)
    CwdPicker.tsx + CwdFolderDialog.tsx + CwdSessionsModal.tsx + MultiCwdList.tsx
                                  working-directory picker + per-cwd sessions
    BranchMessageViewer.tsx       in-session branch view
    CollectionPanel.tsx + SessionLibraryOpenButton.tsx + session-library/
                                  favorites + session-library modal + grid/preview
    ConversationTreeCard.tsx + ConversationTreePanel.tsx
                                  in-session turn tree visualization
    SessionSearch.tsx + SessionTabBar.tsx
                                  keyword search + tab strip
  settings/
    SettingsModal.tsx + rows.tsx + constants.ts + use-immediate-apply.ts
                                  modal + body + form helpers
    ModelsConfig.tsx + models-config/
                                  models.json editor + subviews (ModelDetail, OAuthDetail,
                                  ProviderDetail, ThinkingLevelMapEditor, form-fields, runtime, …)
    SkillsConfig.tsx + skills-config/
                                  skill install + subviews (AddSkillPanel, SkillDetail, SubFileRow, …)
    PromptsConfig.tsx + InboxTestSection.tsx + WeChatSettingsSection.tsx + ProfileBlock.tsx
                                  prompts / inbox test / WeChat / profile blocks
    sections/                     Appearance/AppendSystem/CustomTools/FilePreview/
                                  Profile/Retry/RightBar/Typewriter[Effect]
  todos/
    AgentTodoPanel.tsx            bottom-right circular launcher + popover for agent_todo
    user-todo/                    user-side todo list (TodoPanel + index.ts + FilterBar,
                                  FilterPopover, PriorityChip, PriorityPopover, RichTextEditor[Inner],
                                  SearchPopover, Tag[Color|Manager|Picker]Popover, TextColorPicker,
                                  TodoDescriptionView, TodoItem, TodoMonthCalendar,
                                  AgentToolsPopover, CreateTodoInput, DeadlineControl,
                                  EditTagsModal, palette, types, utils)
  ui/
    AnimatedPopover.tsx + CollapsiblePanel.tsx + ConfirmDialog.tsx + ContextMenu.tsx
    CountBadge.tsx + DatePicker.tsx + HighlightText.tsx + IconHoverButton.tsx
    LoadingState.tsx + MorphToggleIcon.tsx + ProviderIcon.tsx + SidebarSection.tsx
    SmartImage.tsx + TabBar.tsx + TimePicker.tsx + Toast.tsx + Tooltip.tsx + Typewriter.tsx
                                  generic primitives — used everywhere

hooks/
  useAgentSession/                everything chat-window-related: load, stream,
                                  navigate, set model/tools/thinking, compact
    index.ts                      re-export only the public API; consumers import from "@/hooks/useAgentSession"
    hook.ts                       the React hook entry
    events.ts + data.ts + transport.ts + types.ts + utils.ts
                                  internal sub-files (not re-exported)
  useAgentTodo.ts                 polls /api/agent/[id]/agent-todo every 1.5s for the active session
  useI18n.tsx                     en/zh dictionary facade + locale toggle
  useTheme.ts                     CSS theme preset toggle
  useTodos.tsx                    todos provider + hook for user-todo panel
  usePendingPermissions.tsx       provider for the in-session permission queue + PermissionDialog host
  useDragDrop.ts                  drag-and-drop file/image upload
  useModalAnimation.ts            popover enter/exit transitions
  usePopoverPosition.ts           popover viewport-clamp positioning
  useCollapseHeight.ts            height-animating wrapper helper
  useIconMorph.ts                 morphing icon transitions
  useExchangeRate.ts + useFormatCurrency.ts
                                  currency fetch + formatting
  useRss.ts + useRssUnreadCount.ts + rssStore.ts
                                  RSS feeds/articles polling + unread count
  useInbox.ts + useInboxUnreadCount.ts
                                  inbox polling + unread count
  useNotes.tsx                    notes provider + tag list + image upload
  useSessionLibraryEntries.ts     derived entries for the SessionLibrary modal
  useToolCallStats.ts + ToolCallStatsContext.tsx
                                  per-turn tool-call statistics reducer + provider
  sessionUiStore.ts + toolCallStatsStore.ts
                                  module-scoped useSyncExternalStore stores
  sessionWorkspaceStore.ts + sessionLibraryStore.ts + chatHeaderActionsStore.ts
                                  per-session module-scoped stores
  askUserQuestionsStore.ts + showFileResultsStore.ts + cwdListStore.ts + settingsStore.ts
                                  per-feature module-scoped stores

electron-shell/
  main.js                         Electron entry: window + tray + global shortcut + single-instance
  titlebar.html                   macOS-style traffic-light titlebar + iframe allow="clipboard-read; clipboard-write"
  titlebar.js                     IPC bridge: traffic-light buttons + F12/Ctrl+Shift+I DevTools toggle
  titlebar.css                    titlebar styling
  preload.js                      contextBridge preload
  pi.png                          tray + window icon
  start-pi-agent.vbs              Windows launcher helper

scripts/
  todos-restore.ts                roll back todos.db → todos.json
  deploy-systemd-user.sh          deploy to ~/.local/share/pi-work-fork + install user systemd unit
  copy-excalidraw-fonts.mjs       one-time Excalidraw font copy (postinstall-ish)
  test-agent-settings.ts + test-inbox-test-endpoint.ts + test-todo-tools.ts + test-token-audit-store.ts
                                  manual smoke tests (run via `npx tsx scripts/<file>`)

docs/
  agent-todo/                     design + implementation plan for the agent_todo tool
  beautiful-mermaid-examples.md   diagram examples that render in beautiful-mermaid
  configuration-files.md          reverse-engineered map of every ~/.pi-work + ~/.pi/agent file
  echarts-block.md                design + swap rules for the EchartsBlock renderer
  inbox.md                        design for the cross-module inbox
  llm-audit.md                    design for the LLM call audit log
  multi-session-tabs-design.md    exploration doc for multi-tab sessions
  openclaw-weixin-integration.md  reference for the WeChat (openclaw) integration
  pi-sdk-upgrade-report.md        notes from the pi-coding-agent SDK upgrade
  SKILL_find_skills.md            notes on the marketplace skill discovery flow
  subagent-design.md              exploration doc for pi subagent support (not yet implemented)
  wechat-integration.html         interactive docs for the WeChat flow
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/server/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)
- `customTools` registered here: `buildTodoTools(...)`, `buildShowFileTool()` (registers the `show_media` tool), `buildAgentTodoTool()` — the trio that gives pi-work sessions their distinctive toolset

### In-session branching only
Branches live inside a single `.jsonl` file. The `Edit from here` button on any user message calls `navigate_tree` against the current session; the resulting entries share a `parentId` and the BranchNavigator lets the user switch between them. Switching between leaves calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/shared/normalize.ts` handles this — called when loading messages from session files (`lib/server/session-reader.ts`) and when processing streaming events in `useAgentSession`.

### New session tool selection
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames: string[] | "all"`). The selection state in `useAgentSession` is `ToolSelection` (defined in `lib/shared/types.ts`): `[]` ≡ Off (no tools, system prompt cleared — see `lib/server/rpc-manager.ts:831` which is the only way to truly blank it since `buildSystemPrompt` always emits non-empty), `"all"` ≡ Full (every tool pi registers at runtime — a sentinel so future tool additions auto-include), the canonical read-only subset `["find", "ls", "grep", "read"]` ≡ Read only (a named quick preset — `READ_ONLY_TOOLS` constant in `components/chat/chat-input/constants.ts`; `setActiveToolsByName` silently ignores missing names, so a stripped pi build just degrades to its intersection), any other partial `string[]` ≡ Custom (per-tool subset). The ChatInput tools popover (4-row layout) lets the user pick any of these; the wire shape matches the frontend state, so no mapping layer exists. For brand-new sessions that haven't sent their first message yet, the tool catalog is fetched via `POST /api/agent/tools` (spins up an ephemeral session internally).

**Tools button only renders on the new-session page.** Existing sessions cannot change tools mid-flight — the button is hidden (gated on `isNew` in `components/chat/ChatWindow.tsx`). Existing-session tools are whatever the backend has from when the session was last configured (typically the `toolNames` from `POST /api/agent/new` at creation time, possibly mutated by prior `set_tools` calls in this session's lifetime).

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`, plus per-model `thinkingLevels` and `thinkingLevelMaps`. `useAgentSession` pre-selects `defaultModel` on mount for new sessions.

### SSE reconnect on page refresh mid-stream
On `useAgentSession` mount, `GET /api/sessions/[id]?includeState` is called. If `agentState.state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel`, `isCompacting`, and `contextUsage` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Module-scoped stores
`sessionUiStore` and `toolCallStatsStore` follow the same pattern: one typed state object, `useSyncExternalStore` subscription, content-equality guarded patcher (`lib/client/shallowEqual.ts`). `sessionUiStore` exposes both a state snapshot and a separate `useAgentControls()` hook — imperative controls are bridged via the hook, not the snapshot, so identity-based re-render loops are avoided. When adding a new cross-cutting UI state, follow this pattern — it survives `ChatWindow` remounts and eliminates prop-drilling.

### Description sanitization is centralized
`lib/shared/description-sanitize.ts` is the single source of truth for the DOMPurify config used by every code path that touches a todo description: storage normalization, editor save/mount, read-only view render, legacy markdown migration, and zip export (which uses `allowStyle: false`). Adding a new tag/attribute to descriptions requires touching this one file. The `style` widening is gated by an idempotent `uponSanitizeAttribute` hook that rewrites every style value to only `color: #rrggbb` — opening `style` without that hook would be a CSS-injection vector.

### Permission defaults are safe
`PermissionDialog` (Esc → deny, Enter → allow once, backdrop-click → deny) deliberately biases toward deny because "allow similar for this session" is a mouse-only action — keyboard users can never accidentally over-grant.

### Translate panel does not touch disk
`/api/translate` builds a custom `ResourceLoader` that returns empty arrays for everything plus `SessionManager.inMemory()` + `SettingsManager.inMemory()` + `noTools: "all"`. This guarantees the request never reads `~/.pi/agent/settings.json`, never fires any extension hook, and never writes a `.jsonl` file — see the comment at the top of `app/api/translate/route.ts`.

---

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for navigate_tree calls.

## Agent Todo JSONL Format

Location: `~/.pi-work/agent-todo/<sessionId>.jsonl`

```jsonl
{"ts":<ms>,"action":"create","stateAfter":{"tasks":[...],"nextId":2}}
{"ts":<ms>,"action":"update","stateAfter":{...}}
```

Append-only snapshots — current state is the last parsed line's `stateAfter`. O(1) tail read. `agent-todo-store.ts` always `fsync`s before returning the tool result. The frontend fetches once when entering a session and fetches again after each `agent_todo` `tool_execution_end` event; there is no background polling. Deleted tasks are removed from current state while the audit history remains.

---

## CSS Variables (`app/globals.css`)

Theme presets (`.theme-default`, `.theme-midnight`, `.theme-synthwave`, `.theme-forest`, …) set these vars; pick from `useTheme`.

```
--bg --bg-panel --bg-hover --bg-selected --bg-subtle --border
--text --text-muted --text-dim
--accent --accent-hover --user-bg --assistant-bg --tool-bg
--font-sans --font-mono
```

The LXGW WenKai font (CJK) was previously vendored but has been removed; CJK characters now fall through `--font-sans` to the system font stack (`PingFang SC`, `Microsoft YaHei`, etc.). Noto Sans Mono is loaded via `next/font/google` as `--font-noto-mono`.

---

## i18n for Frontend Text

**All user-visible strings in new components must go through i18n — never hardcode display text.**

When adding or modifying frontend components:
- Extract every user-facing string (labels, placeholders, tooltips, aria-labels, status messages, error text) into the i18n dictionary under `lib/shared/i18n-dict/` (group by feature: `chat.ts`, `settings.ts`, `rss.ts`, …). The public API exposed via `t('key')` from `useI18n()` (`hooks/useI18n.tsx`) is unchanged.
- Use the project's existing i18n mechanism (`t('key')` from `useI18n()`) — don't invent a new pattern.
- Keys are the English source string itself; add the Chinese translation in the `ZH_TRANSLATIONS` map. Look at nearby keys before creating new ones.

---

## Toast Notifications for New Frontend Interactions

**Any new user-initiated frontend action that can fail or completes silently needs a toast — see `components/ui/Toast.tsx` for the global system.**

When adding or modifying frontend interactions, decide whether a toast is needed:

- **Add a toast** for: server-bound actions (save, delete, rename, send, copy, fetch, OAuth login, install, export, scheduler run, HTTP send/cancel) and for successes of operations that otherwise complete silently.
- **Skip a toast** for: actions whose feedback is purely local UI state (toggles, expand/collapse, theme switch, sound on/off) and for forms where the error must stay inline next to the field (rename conflicts, validation messages, modal-internal footer text).

Conventions:
- Call `useToast()` from `@/components/ui/Toast` and invoke `toast.show({ kind, message })` — don't invent a parallel notification mechanism.
- Prefer the server-provided error string and fall back to a generic i18n key: `e instanceof Error && e.message ? e.message : t("Network error")`.
- Past-tense keys cover most successes (`t("Saved")`, `t("Renamed")`, `t("Copied")`, `t("Deleted")`); add new keys to `hooks/useI18n.tsx` only when none fits. The "Common-operation toasts" comment in `useI18n.tsx` is the canonical place to add them.
- Modal-internal feedback (the "Saved" button label, red footer text) should stay in addition to the toast — the toast is the cross-area confirmation that survives outside the modal.
- The 1-second dedupe in `Toast.tsx` handles repeated onerror events; don't add your own.
- `useConfirm()` from `@/components/ui/ConfirmDialog` is the matching modal for destructive confirms ("Delete this collection?", "Cancel this HTTP request?") — pair with a toast on success.

---

## Tooltips for New Frontend Interactions

**Hover hints must use the project's unified `Tooltip` component (`components/ui/Tooltip.tsx`, Radix-backed) — never the native `title` attribute.**

When adding a hover explanation (e.g. a truncated filename showing its full path):
- Wrap the trigger element with `<Tooltip content={...}>` — it renders via portal, follows the app's theme variables, and styles consistently with the rest of the UI.
- Do **not** set `title="..."` on the same element — the browser's default tooltip is unstyled, delayed differently, and appears on top of the unified one, making them fight.
- Prefer `content` over `aria-label` for non-interactive hints; keep `aria-label` for interactive semantics (buttons).

---

## Clipboard in the Electron Shell

When Pi Work is loaded inside the `electron-shell` `<iframe>`, every
`navigator.clipboard.writeText()` call requires the iframe to declare
`allow="clipboard-read; clipboard-write"` (set in `electron-shell/titlebar.html`).
Without it, Chromium's Permissions-Policy silently blocks the call. The web
app has a `document.execCommand("copy")` fallback in `components/files/CodeBlock.tsx`'s
`copyText()` helper (also reached by `components/files/MermaidBlock.tsx`,
`components/files/SvgBlock.tsx`, `components/files/FileExplorer.tsx`) — but
the iframe attribute is the canonical fix and the fallback should not be
relied on.

---

# Interaction

- Interact with users in Chinese.
- Interact with users in Chinese.
- Interact with users in Chinese.
