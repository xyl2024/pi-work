"use client";

import { useEffect } from "react";

/**
 * Suppresses the browser's default Tab-key behavior app-wide so that focus
 * doesn't migrate between focusable elements on every Tab / Shift+Tab press.
 *
 * The interceptor runs in the capture phase, before any element-level
 * `onKeyDown` handler. Components that want to give Tab a custom meaning
 * (e.g. ChatInput's Tab-to-cycle-thinking-level, CreateTodoInput's
 * Tab-to-pick-suggestion) keep working because:
 *
 *   - preventDefault only blocks the default action; it does not stop the
 *     event from continuing to bubble, so their `onKeyDown` still runs.
 *   - Their own `e.preventDefault()` calls become harmless no-ops on top of
 *     ours.
 *
 * IME composition sessions are respected (the OS owns the keystroke while
 * the user is in the middle of typing a CJK character), so Tab inside a
 * composition is left alone — the browser still doesn't move focus in that
 * case anyway, but skipping the call keeps the contract clean.
 *
 * Accessibility note: WCAG 2.1.1 (Keyboard) is intentionally not satisfied
 * here. The product already lets every focusable element be reached with
 * the mouse or activated with Enter/Space (for <button> / <a>); Tab is
 * reserved for places that re-purpose it as a control surface (see
 * components/chat/ChatInput.tsx handleThinkingTabKeyDown,
 * components/todos/user-todo/CreateTodoInput.tsx Tag dropdown handler).
 */
export function useDisableDefaultTab(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      // Skip if an IME composition session owns the keystroke.
      if (e.isComposing) return;
      e.preventDefault();
    };
    // Capture phase: run before any element-level React onKeyDown.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
