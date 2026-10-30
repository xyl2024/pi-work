import { describe, expect, it } from "vitest";
import {
  CHANNELS_ROOT_PAGE,
  backChannelsPage,
  channelsPagesAfterCreate,
  channelsPagesAfterDelete,
  createChannelsPageStack,
  currentChannelsPage,
  isChannelsRootPage,
  openChannelsPage,
  type ChannelsPage,
} from "@/lib/shared/channels-pages";

function detail(channelId: string): ChannelsPage {
  return { kind: "detail", channelId };
}

describe("createChannelsPageStack / currentChannelsPage", () => {
  it("starts on the channel list", () => {
    expect(createChannelsPageStack()).toEqual([CHANNELS_ROOT_PAGE]);
  });

  it("resolves an empty stack to the list", () => {
    expect(currentChannelsPage([])).toEqual(CHANNELS_ROOT_PAGE);
  });
});

describe("openChannelsPage", () => {
  it("opens a channel detail above the list", () => {
    expect(openChannelsPage(detail("a"))).toEqual([CHANNELS_ROOT_PAGE, detail("a")]);
  });

  it("replaces a sibling detail page instead of growing the stack", () => {
    const first = openChannelsPage(detail("a"));
    const second = openChannelsPage(detail("b"));
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second).toEqual([CHANNELS_ROOT_PAGE, detail("b")]);
  });

  it("returns to the list when asked for the root page", () => {
    expect(openChannelsPage({ kind: "root" })).toEqual([CHANNELS_ROOT_PAGE]);
  });
});

describe("backChannelsPage", () => {
  it("pops one level", () => {
    expect(backChannelsPage([CHANNELS_ROOT_PAGE, detail("a")])).toEqual([CHANNELS_ROOT_PAGE]);
  });

  it("is a no-op on the list", () => {
    expect(backChannelsPage([CHANNELS_ROOT_PAGE])).toEqual([CHANNELS_ROOT_PAGE]);
    expect(backChannelsPage([])).toEqual([CHANNELS_ROOT_PAGE]);
  });
});

describe("isChannelsRootPage", () => {
  it("is true on the list and empty stack, false on a detail page", () => {
    expect(isChannelsRootPage([CHANNELS_ROOT_PAGE])).toBe(true);
    expect(isChannelsRootPage([])).toBe(true);
    expect(isChannelsRootPage([CHANNELS_ROOT_PAGE, detail("a")])).toBe(false);
  });
});

describe("convergence", () => {
  it("lands on the new channel's detail page after a create", () => {
    expect(channelsPagesAfterCreate("new")).toEqual([CHANNELS_ROOT_PAGE, detail("new")]);
  });

  it("draws the stack back to the list after a delete", () => {
    expect(channelsPagesAfterDelete()).toEqual([CHANNELS_ROOT_PAGE]);
  });
});
