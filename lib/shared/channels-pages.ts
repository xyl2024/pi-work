/**
 * Page stack for the channels panel view.
 *
 * The panel navigates in levels instead of squeezing a platform column + a
 * detail pane into a one-third-wide strip. There are exactly two levels:
 *
 *   0. root   — the new-channel input + the channel list;
 *   1. detail — one channel's status / rename / enable / workspace /
 *      scan-login card / health / activity feed, carrying its id.
 *
 * Every page is full width with a back control, so Back always returns one
 * level up. The stack is bounded: opening another channel's detail page
 * replaces the previous one rather than growing. This module owns the rules so
 * they can be driven from `tests/unit` without a browser —
 * `lib/client/channels-store.ts` holds the current stack and the panel renders
 * `currentChannelsPage`.
 *
 * Two convergence rules ride on top of push/back: creating a channel lands on
 * the new channel's detail page (the next step is always "scan to connect"),
 * and deleting one draws the stack back to the list.
 */

/** One level of the panel's navigation. */
export type ChannelsPage =
  | { kind: "root" }
  | { kind: "detail"; channelId: string };

/** The channel list — the bottom of every stack. */
export const CHANNELS_ROOT_PAGE: ChannelsPage = { kind: "root" };

/** A fresh stack, sitting on the channel list. */
export function createChannelsPageStack(): ChannelsPage[] {
  return [CHANNELS_ROOT_PAGE];
}

/** The page the panel renders: the top of the stack, root when it is empty. */
export function currentChannelsPage(pages: readonly ChannelsPage[]): ChannelsPage {
  return pages.length > 0 ? pages[pages.length - 1] : CHANNELS_ROOT_PAGE;
}

/**
 * Enter a page. A detail page is a root-level sibling of the list, so sibling
 * navigation (channel A → channel B) replaces the previous one instead of
 * growing the stack.
 */
export function openChannelsPage(page: ChannelsPage): ChannelsPage[] {
  if (page.kind === "root") return createChannelsPageStack();
  return [CHANNELS_ROOT_PAGE, page];
}

/** Pop one level. The channel list is a floor: backing off it is a no-op. */
export function backChannelsPage(pages: readonly ChannelsPage[]): ChannelsPage[] {
  if (pages.length <= 1) return createChannelsPageStack();
  return pages.slice(0, -1);
}

/**
 * Whether the stack is sitting on the channel list, i.e. an Escape cannot pop
 * a level and the panel is free to run its tab-close rules instead.
 */
export function isChannelsRootPage(pages: readonly ChannelsPage[]): boolean {
  return pages.length <= 1;
}

/** Where a successful create lands: the new channel's detail page. */
export function channelsPagesAfterCreate(channelId: string): ChannelsPage[] {
  return openChannelsPage({ kind: "detail", channelId });
}

/** Where a delete lands: back on the list, with the deleted channel gone. */
export function channelsPagesAfterDelete(): ChannelsPage[] {
  return createChannelsPageStack();
}
