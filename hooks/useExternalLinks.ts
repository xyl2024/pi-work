"use client";

import { useEffect } from "react";
import { resolveNewTabUrl } from "@/lib/shared/external-link";

/**
 * App-wide click interceptor: a plain left-click on an external link opens it
 * in a new tab instead of replacing the Pi Work page.
 *
 * Why a document-level listener rather than a wrapper component: links are
 * rendered by a dozen unrelated surfaces (chat markdown, notes, RSS, inbox,
 * OAuth, …) and by `react-markdown` itself, so the only place that can see all
 * of them is the document. This is the same approach as `useDisableDefaultTab`.
 *
 * The rule lives in `lib/shared/external-link.ts`; this hook only does the DOM
 * work — find the anchor under the pointer, and open the URL the rule
 * returned. The click is left untouched when:
 *
 *   - something already handled it (`defaultPrevented`), so a component's own
 *     `onClick` keeps winning;
 *   - a modifier is held, because Ctrl/Cmd+click (background tab),
 *     Shift+click (new window) and Alt+click (download) are the browser's own
 *     gestures and must keep their native meaning;
 *   - it is not a left click (middle click already opens a new tab natively).
 *
 * In the Electron shell the `window.open` below never creates a window: the
 * main process hands it to the default browser (see `electron-shell/main.js`).
 */
export function useExternalLinks(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      const anchor = target instanceof Element ? target.closest("a[href]") : null;
      if (!anchor) return;

      const url = resolveNewTabUrl({
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        download: anchor.hasAttribute("download"),
        baseUrl: window.location.href,
      });
      if (!url) return;

      event.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
    };
  }, []);
}
