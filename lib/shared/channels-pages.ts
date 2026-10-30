export type ChannelsPage =
  | { kind: "root" }
  | { kind: "detail"; channelId: string };

export const CHANNELS_ROOT_PAGE: ChannelsPage = { kind: "root" };

export function createChannelsPageStack(): ChannelsPage[] {
  return [CHANNELS_ROOT_PAGE];
}

export function currentChannelsPage(pages: readonly ChannelsPage[]): ChannelsPage {
  return pages.length > 0 ? pages[pages.length - 1] : CHANNELS_ROOT_PAGE;
}

export function openChannelsPage(page: ChannelsPage): ChannelsPage[] {
  if (page.kind === "root") return createChannelsPageStack();
  return [CHANNELS_ROOT_PAGE, page];
}

export function backChannelsPage(pages: readonly ChannelsPage[]): ChannelsPage[] {
  if (pages.length <= 1) return createChannelsPageStack();
  return pages.slice(0, -1);
}

export function isChannelsRootPage(pages: readonly ChannelsPage[]): boolean {
  return pages.length <= 1;
}

export function channelsPagesAfterCreate(channelId: string): ChannelsPage[] {
  return openChannelsPage({ kind: "detail", channelId });
}

export function channelsPagesAfterDelete(): ChannelsPage[] {
  return createChannelsPageStack();
}
