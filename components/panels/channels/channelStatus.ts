import type { ChannelStatus } from "@/lib/shared/channels/types";

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
