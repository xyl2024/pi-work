"use client";

import { Tooltip } from "../ui/Tooltip";
import { CountBadge } from "../ui/CountBadge";
import { BellIcon } from "../ui/animated-icons";

interface Props {
  unread: number;
  onClick: () => void;
  tooltip?: string;
}

export function InboxBell({ unread, onClick, tooltip = "Open inbox" }: Props) {
  return (
    <Tooltip content={tooltip}>
      <button
        onClick={onClick}
        aria-label={tooltip}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          padding: 0,
          flexShrink: 0,
          background: "none",
          border: "none",
          borderRadius: 7,
          color: "var(--text-muted)",
          cursor: "pointer",
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <BellIcon size={15} />
        <CountBadge count={unread} size="sm" />
      </button>
    </Tooltip>
  );
}