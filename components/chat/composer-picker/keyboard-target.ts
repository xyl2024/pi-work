export function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && target.closest("button, input, textarea, select, a, [contenteditable='true']") !== null;
}
