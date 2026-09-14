// ============================================================================
// External links (pure)
//
// Whether a plain left-click on an `<a>` should be handed to a new tab
// instead of navigating the Pi Work page itself is a rule, not wiring, so it
// lives here and is pinned down without a browser:
//
//   - only absolute `http:` / `https:` targets are redirected. In-page
//     fragments (`#…`), relative app routes, the login redirect and every
//     non-web scheme (`mailto:`, `tel:`, `javascript:`, `data:`, `file:`) are
//     left to the browser — navigating to those never unloads the page, and
//     the app's own pages must keep working;
//   - a link into the app's own origin is an in-app route and stays in the
//     current tab;
//   - an anchor that already names a new browsing context (`target="_blank"`
//     or a named frame) is left alone so the click is not opened twice, and a
//     `download` anchor keeps downloading.
//
// The DOM side — finding the anchor under the pointer, `preventDefault` and
// `window.open` — stays in `hooks/useExternalLinks.ts`. Like `chat-timeline`,
// `scroll-follow` and `panelTabs` (ADR-0003) this module may not import React,
// the DOM, a client hook, or anything from `lib/server`.
// ============================================================================

/** Schemes that may replace the current document and are therefore the only
 *  ones worth moving to a new tab. */
const WEB_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Whether an anchor's `target` sends the click into a new browsing context on
 * its own — `_blank`, or a named frame/window. `_self`, `_parent`, `_top` and
 * a missing target all stay in the frame hierarchy and are the app's business.
 */
export function opensNewContext(target?: string | null): boolean {
  const value = target?.trim().toLowerCase();
  if (!value) return false;
  return value === "_blank" || !value.startsWith("_");
}

/**
 * The URL a plain left-click on this anchor should open in a **new** tab, or
 * `null` when the click must be left to the browser (in-app route, fragment,
 * download, already opening a new context, non-web scheme, unusable href).
 */
export function resolveNewTabUrl(input: {
  /** The anchor's raw `href` attribute (not the resolved `HTMLAnchorElement.href`),
   *  so fragments and relative routes stay recognizable. */
  href?: string | null;
  target?: string | null;
  download?: boolean;
  /** The document's URL, used to resolve relative hrefs. */
  baseUrl: string;
}): string | null {
  const href = input.href?.trim();
  if (!href) return null;
  if (href.startsWith("#")) return null;
  if (input.download) return null;
  if (opensNewContext(input.target)) return null;

  let url: URL;
  let base: URL;
  try {
    url = new URL(href, input.baseUrl);
    base = new URL(input.baseUrl);
  } catch {
    return null;
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) return null;
  if (url.origin === base.origin) return null;
  return url.href;
}
