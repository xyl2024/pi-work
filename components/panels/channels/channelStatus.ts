import type { ChannelStatus } from "@/lib/shared/channels/types";

/**
 * Presentation helpers shared by the channels panel's two pages (root list and
 * detail page). Kept in their own module, not exported from the root page, so
 * the detail page does not import a sibling page just for a status dot.
 */

/** Accent per status: connected / expired / disabled / pending. */
export function channelStatusColor(status: ChannelStatus): string {
  switch (status) {
    case "connected":
      return "var(--accent)";
    case "expired":
      return "#ef4444";
    case "disabled":
      return "var(--text-muted)";
    case "pending":
      return "#f59e0b";
  }
}

/** The i18n key for a channel's status word. */
export function channelStatusLabelKey(status: ChannelStatus): string {
  switch (status) {
    case "connected":
      return "channels.connected";
    case "expired":
      return "channels.expired";
    case "disabled":
      return "channels.disabled";
    case "pending":
      return "channels.pending";
  }
}
