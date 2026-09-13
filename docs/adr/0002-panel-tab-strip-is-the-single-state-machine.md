# The panel tab strip is the single state machine for panel open/close

Every rule of the right panel used to live in `AppShell`: a 14-variant tab union, one open handler per panel view, a `toggleRightPanelTab(tabId, opener)` that re-implemented "clicking the active tab collapses the panel", and three separate close fallbacks. The rules had drifted into two copies of the toggle rule and four copies of "which tab becomes active after a close". Tab labels were baked with `t()` at open time, so an already open tab kept the language it was opened in (only three kinds were patched at render time), and the two counters panels needed — git diff's refresh token, BTW's focus request — were private shell state.

We decided that the strip itself is one pure state machine in the shared layer: `lib/shared/panelTabs.ts` holds the identity registry (kind → tab id, label key, default mode, session binding, optional command entry) and a reducer over `{ tabs, activeId, mode }` with the actions `open` / `open_file` / `activate` / `toggle` / `close` / `close_left` / `close_right` / `close_others` / `set_mode`. Selectors expose the active tab and kind, `isOpen`, `hasTabs`, and `canExpand(state, layoutMode)` — the last one absorbing Classic ("open ⇒ visible") vs Agentic ("open and non-empty ⇒ visible"). Labels are stored as keys and resolved at render, so open tabs follow a locale switch. Each tab carries an `openCount` bumped on every open, replacing the per-panel counters that panels observe for refresh/focus.

Presentation deliberately stays out: the right-bar descriptors keep the icon and body, looked up by kind. Adding a panel view is therefore two registrations (one spec, one descriptor entry) instead of the eight places it used to take, and file preview tabs share the same strip and the same close rules as panel views. The shell consumes the reducer state directly — there is no adapter layer, and the `RIGHT_BAR_ID_FOR_TAB_KIND` map that used to sit in `lib/shared/types.ts` is derived from the registry (`panelButtonIdForKind`).

## Considered options

- **Keep the handlers in `AppShell` and only share the toggle helper.** Smallest diff, but leaves the close fallback and "last tab closes the panel" rules duplicated, and keeps panel identity (tab ids, labels, command entries) spread across the shell, the descriptors, the palette and the config defaults.
- **A React context/provider owning the strip.** Same rules, but untestable without jsdom, and the panels' open/close behaviour is not view state that any component may arbitrarily subscribe to — it is a reducer over a list.
- **Deriving the persisted config defaults from the registry now.** Tempting (it is what still leaves `canvas` / `json` in user `config.yaml`), but it touches server config and the settings UI, so it is a separate slice.

## Consequences

- `panelTabs` may not import React, the DOM, the client hooks or anything server-side; the layout mode is passed in as `PanelLayoutMode` instead of read from the client store.
- The registry is keyed by `RightBarButtonId`, so a new right-bar button cannot ship without a panel identity, and a panel kind cannot appear without a button id.
- The shell keeps no panel state: `AppShell` dispatches actions, reads `selectActiveTab` / `selectOpenCount` directly, and the tab bar renders `PanelTab`s by resolving `labelKey` at render time.
- Palette panel commands and right-bar buttons share one toggle path (`togglePanel`), matching "clicking the active view collapses the panel".
- Behaviour is intentionally unchanged, including "close falls back to the oldest tab" and "the palette commands toggle rather than open"; any change to those rules is a separate product decision.
