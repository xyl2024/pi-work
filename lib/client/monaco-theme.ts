"use client";

import type * as Monaco from "monaco-editor";

export const PI_WORK_DARK_THEME_NAME = "pi-work-dark";

let registered = false;

export function registerPiWorkDarkTheme(monaco: typeof Monaco): void {
	if (registered) return;
	monaco.editor.defineTheme(PI_WORK_DARK_THEME_NAME, {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "7a8599", fontStyle: "italic" },
			{ token: "comment.documentation", foreground: "7a8599" },

			{ token: "string", foreground: "98c379" },
			{ token: "string.quoted", foreground: "98c379" },
			{ token: "regexp", foreground: "56b6c2" },

			{ token: "number", foreground: "d19a66" },
			{ token: "constant.numeric", foreground: "d19a66" },
			{ token: "constant.language", foreground: "d19a66" },
			{ token: "constant.character.escape", foreground: "56b6c2" },

			{ token: "keyword", foreground: "c678dd" },
			{ token: "keyword.control", foreground: "c678dd" },
			{ token: "keyword.control.flow", foreground: "c678dd" },
			{ token: "keyword.operator", foreground: "c678dd" },
			{ token: "storage", foreground: "c678dd" },
			{ token: "storage.type", foreground: "c678dd" },
			{ token: "storage.modifier", foreground: "c678dd" },

			{ token: "operator", foreground: "56b6c2" },
			{ token: "delimiter", foreground: "abb2bf" },
			{ token: "delimiter.bracket", foreground: "abb2bf" },
			{ token: "delimiter.parenthesis", foreground: "abb2bf" },
			{ token: "delimiter.array", foreground: "abb2bf" },
			{ token: "punctuation", foreground: "abb2bf" },

			{ token: "type", foreground: "e5c07b" },
			{ token: "type.identifier", foreground: "e5c07b" },
			{ token: "type.builtin", foreground: "e5c07b" },

			{ token: "entity.name.function", foreground: "61afef" },
			{ token: "support.function", foreground: "61afef" },
			{ token: "variable.function", foreground: "61afef" },

			{ token: "variable", foreground: "bcbcbc" },
			{ token: "variable.parameter", foreground: "e06c75" },
			{ token: "variable.readwrite", foreground: "bcbcbc" },
			{ token: "variable.predefined", foreground: "d19a66" },

			{ token: "tag", foreground: "e06c75" },
			{ token: "metatag", foreground: "e06c75" },
			{ token: "attribute.name", foreground: "d19a66" },
			{ token: "attribute.value", foreground: "98c379" },

			{ token: "invalid", foreground: "ff7b72", fontStyle: "underline" },
			{ token: "invalid.deprecated", foreground: "ff7b72", fontStyle: "underline" },

		],
		colors: {
			"editor.background": "#24242a",
			"editor.foreground": "#bcbcbc",
			"editor.lineHighlightBackground": "#2e2e34",
			"editor.lineHighlightBorder": "#2e2e34",
			"editorCursor.foreground": "#7aa2f7",
			"editorGutter.background": "#24242a",
			"editorLineNumber.foreground": "#5c6370",
			"editorLineNumber.activeForeground": "#bcbcbc",
			"editorIndentGuide.background": "#2e2e34",
			"editorIndentGuide.activeBackground": "#3a3a3a",

			"editor.selectionBackground": "#3e4a6a",
			"editor.selectionHighlightBackground": "#3e4a6a",
			"editor.inactiveSelectionBackground": "#3a3a3a",
			"editor.wordHighlightBackground": "#3a4358",
			"editor.wordHighlightStrongBackground": "#3e4a6a",

			"editor.findMatchBackground": "#3e4a6a",
			"editor.findMatchHighlightBackground": "#3a4358",
			"editor.findRangeHighlightBackground": "#3a4358",
			"editor.rangeHighlightBackground": "#3a4358",

			"scrollbar.shadow": "#00000033",
			"scrollbarSlider.background": "#3a3a3a",
			"scrollbarSlider.hoverBackground": "#5c6370",
			"scrollbarSlider.activeBackground": "#7aa2f7",

			"minimap.background": "#24242a",
			"minimap.findMatchHighlight": "#3e4a6a",
			"minimap.selectionHighlight": "#3e4a6a",
			"minimap.errorHighlight": "#ff7b72",
			"minimap.warningHighlight": "#e3b341",

			"editorError.foreground": "#ff7b72",
			"editorWarning.foreground": "#e3b341",
			"editorInfo.foreground": "#7aa2f7",
			"editorHint.foreground": "#9a9894",

			"editorWidget.background": "#2e2e34",
			"editorWidget.border": "#3a3a3a",
			"editorWidget.resizeBorder": "#7aa2f7",
			"editorSuggestWidget.background": "#2e2e34",
			"editorSuggestWidget.border": "#3a3a3a",
			"editorSuggestWidget.selectedBackground": "#383838",
			"editorSuggestWidget.highlightForeground": "#7aa2f7",
			"editorSuggestWidget.focusHighlightForeground": "#7aa2f7",
			"editorHoverWidget.background": "#2e2e34",
			"editorHoverWidget.border": "#3a3a3a",
			"editorHoverWidget.statusBarBackground": "#3a3a3a",

			"peekViewEditor.background": "#1e1e22",
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

			"editorBracketMatch.background": "#3e4a6a",
			"editorBracketMatch.border": "#7aa2f7",

			"editor.focusedStackFrameHighlightBackground": "#3e4a6a",
			"editor.unfocusedStackFrameHighlightBackground": "#2e2e34",
		},
	});
	registered = true;
}
