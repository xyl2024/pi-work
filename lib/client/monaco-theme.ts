"use client";

// Custom Monaco theme tuned to match Pi Work's dark presets.
//
// The right-side file viewer (`components/files/file-viewer/MonacoViewer.tsx`)
// uses Monaco. Out of the box it points at Monaco's built-in `vs-dark`
// theme, whose background and selection colors don't match any of Pi
// Work's presets — the editor feels grafted on instead of belonging.
//
// This module registers a single `pi-work-dark` theme whose chrome
// colors are pulled straight from `theme-dark` in app/globals.css
// (`--bg`, `--bg-panel`, `--border`, `--text`, `--accent`, …) so the
// editor visibly belongs to the surrounding UI. Syntax-highlighting
// tokens pick from a One-Dark-leaning palette (purple / cyan / green
// / amber / red) which harmonises with Pi Work's own git-status
// colors (`--success #7ee787`, `--warning #e3b341`, `--error #ff7b72`)
// and `--accent #7aa2f7`.
//
// Why `base: "vs-dark"`:
//   - Inherits sensible defaults for slots we don't override (bracket
//     pair colors, code-folding markers, ruler glyphs, etc.) so we
//     only have to spell out the tokens & colors we care about.
//   - Keeps Monaco's internal "is dark" heuristics working (e.g. the
//     light-on-dark contrast in marker margins).

import type * as Monaco from "monaco-editor";

/** Theme name referenced from MonacoViewer. Picked to make it obvious
 *  this is a Pi Work override vs Monaco's built-ins (`vs-dark`,
 *  `hc-black`). */
export const PI_WORK_DARK_THEME_NAME = "pi-work-dark";

/** Whether `registerPiWorkDarkTheme` has already run on this Monaco
 *  module instance. `useMonacoLoader` shares a single module across
 *  every consumer (the promise is module-level), so a one-shot guard
 *  is enough — but it also keeps HMR / multi-mount paths from
 *  triggering duplicate-registration warnings. */
let registered = false;

/**
 * Register `pi-work-dark` with Monaco. Idempotent: a second call on
 * the same Monaco instance re-defines the theme without error and is
 * a no-op for our local flag.
 *
 * Call this once Monaco has loaded but before any editor instance is
 * created — `useMonacoLoader.ts` does that.
 */
export function registerPiWorkDarkTheme(monaco: typeof Monaco): void {
	if (registered) return;
	monaco.editor.defineTheme(PI_WORK_DARK_THEME_NAME, {
		base: "vs-dark",
		inherit: true,
		rules: [
			// ── comments / meta ────────────────────────────────────
			{ token: "comment", foreground: "7a8599", fontStyle: "italic" },
			{ token: "comment.documentation", foreground: "7a8599" },

			// ── strings / regex ────────────────────────────────────
			{ token: "string", foreground: "98c379" },
			{ token: "string.quoted", foreground: "98c379" },
			{ token: "regexp", foreground: "56b6c2" },

			// ── numbers / constants ────────────────────────────────
			{ token: "number", foreground: "d19a66" },
			{ token: "constant.numeric", foreground: "d19a66" },
			{ token: "constant.language", foreground: "d19a66" },
			{ token: "constant.character.escape", foreground: "56b6c2" },

			// ── keywords / storage ─────────────────────────────────
			{ token: "keyword", foreground: "c678dd" },
			{ token: "keyword.control", foreground: "c678dd" },
			{ token: "keyword.control.flow", foreground: "c678dd" },
			{ token: "keyword.operator", foreground: "c678dd" },
			{ token: "storage", foreground: "c678dd" },
			{ token: "storage.type", foreground: "c678dd" },
			{ token: "storage.modifier", foreground: "c678dd" },

			// ── operators / punctuation ────────────────────────────
			{ token: "operator", foreground: "56b6c2" },
			{ token: "delimiter", foreground: "abb2bf" },
			{ token: "delimiter.bracket", foreground: "abb2bf" },
			{ token: "delimiter.parenthesis", foreground: "abb2bf" },
			{ token: "delimiter.array", foreground: "abb2bf" },
			{ token: "punctuation", foreground: "abb2bf" },

			// ── types ──────────────────────────────────────────────
			{ token: "type", foreground: "e5c07b" },
			{ token: "type.identifier", foreground: "e5c07b" },
			{ token: "type.builtin", foreground: "e5c07b" },

			// ── functions / calls ──────────────────────────────────
			{ token: "entity.name.function", foreground: "61afef" },
			{ token: "support.function", foreground: "61afef" },
			{ token: "variable.function", foreground: "61afef" },

			// ── variables ──────────────────────────────────────────
			{ token: "variable", foreground: "bcbcbc" },
			{ token: "variable.parameter", foreground: "e06c75" },
			{ token: "variable.readwrite", foreground: "bcbcbc" },
			{ token: "variable.predefined", foreground: "d19a66" },

			// ── HTML / JSX ─────────────────────────────────────────
			{ token: "tag", foreground: "e06c75" },
			{ token: "metatag", foreground: "e06c75" },
			{ token: "attribute.name", foreground: "d19a66" },
			{ token: "attribute.value", foreground: "98c379" },

			// ── misc ───────────────────────────────────────────────
			{ token: "invalid", foreground: "ff7b72", fontStyle: "underline" },
			{ token: "invalid.deprecated", foreground: "ff7b72", fontStyle: "underline" },

		],
		colors: {
			// ── editor chrome ──────────────────────────────────────
			"editor.background": "#24242a", //   --bg
			"editor.foreground": "#bcbcbc", //   --text
			"editor.lineHighlightBackground": "#2e2e34", //   --bg-panel
			"editor.lineHighlightBorder": "#2e2e34",
			"editorCursor.foreground": "#7aa2f7", //   --accent
			"editorGutter.background": "#24242a",
			"editorLineNumber.foreground": "#5c6370", //   dimmer than --text-dim
			"editorLineNumber.activeForeground": "#bcbcbc",
			"editorIndentGuide.background": "#2e2e34",
			"editorIndentGuide.activeBackground": "#3a3a3a", //   --border

			// ── selection / word highlight ─────────────────────────
			"editor.selectionBackground": "#3e4a6a", //   accent @ ~22% over --bg
			"editor.selectionHighlightBackground": "#3e4a6a",
			"editor.inactiveSelectionBackground": "#3a3a3a",
			"editor.wordHighlightBackground": "#3a4358",
			"editor.wordHighlightStrongBackground": "#3e4a6a",

			// ── find (Ctrl-F) ──────────────────────────────────────
			"editor.findMatchBackground": "#3e4a6a",
			"editor.findMatchHighlightBackground": "#3a4358",
			"editor.findRangeHighlightBackground": "#3a4358",
			"editor.rangeHighlightBackground": "#3a4358",

			// ── scrollbar ──────────────────────────────────────────
			"scrollbar.shadow": "#00000033",
			"scrollbarSlider.background": "#3a3a3a",
			"scrollbarSlider.hoverBackground": "#5c6370",
			"scrollbarSlider.activeBackground": "#7aa2f7",

			// ── minimap ────────────────────────────────────────────
			"minimap.background": "#24242a",
			"minimap.findMatchHighlight": "#3e4a6a",
			"minimap.selectionHighlight": "#3e4a6a",
			"minimap.errorHighlight": "#ff7b72",
			"minimap.warningHighlight": "#e3b341",

			// ── marker glyph (errors / warnings in gutter) ─────────
			"editorError.foreground": "#ff7b72", //   --error
			"editorWarning.foreground": "#e3b341", //   --warning
			"editorInfo.foreground": "#7aa2f7", //   --accent
			"editorHint.foreground": "#9a9894",

			// ── widgets (autocomplete / hover / parameter hints) ───
			"editorWidget.background": "#2e2e34",
			"editorWidget.border": "#3a3a3a",
			"editorWidget.resizeBorder": "#7aa2f7",
			"editorSuggestWidget.background": "#2e2e34",
			"editorSuggestWidget.border": "#3a3a3a",
			"editorSuggestWidget.selectedBackground": "#383838", //   --bg-selected
			"editorSuggestWidget.highlightForeground": "#7aa2f7",
			"editorSuggestWidget.focusHighlightForeground": "#7aa2f7",
			"editorHoverWidget.background": "#2e2e34",
			"editorHoverWidget.border": "#3a3a3a",
			"editorHoverWidget.statusBarBackground": "#3a3a3a",

			// ── peek view (Go to Definition / References) ──────────
			"peekViewEditor.background": "#1e1e22", //   one notch darker than --bg
			"peekViewEditorGutter.background": "#1e1e22",
			"peekViewEditor.matchHighlightBackground": "#3e4a6a",
			"peekViewResult.background": "#2e2e34",
			"peekViewResult.lineForeground": "#bcbcbc",
			"peekViewResult.matchHighlightBackground": "#3e4a6a",
			"peekViewResult.selectionBackground": "#383838",
			"peekViewResult.selectionForeground": "#bcbcbc",
			"peekViewTitle.background": "#2e2e34",
			"peekViewTitleDescription.foreground": "#9a9894",
			"peekViewTitleLabel.foreground": "#bcbcbc",
			"peekView.border": "#3a3a3a",

			// ── bracket pair colorization ──────────────────────────
			"editorBracketMatch.background": "#3e4a6a",
			"editorBracketMatch.border": "#7aa2f7",

			// ── focused / unfocused editor chrome ──────────────────
			"editor.focusedStackFrameHighlightBackground": "#3e4a6a",
			"editor.unfocusedStackFrameHighlightBackground": "#2e2e34",
		},
	});
	registered = true;
}
