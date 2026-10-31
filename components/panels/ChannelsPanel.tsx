"use client";

import { useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { channelsPanel, useChannelsPanel } from "@/lib/client/channels-panel";
import { ChannelsRootPage } from "./channels/ChannelsRootPage";
import { ChannelDetailPage } from "./channels/ChannelDetailPage";

export function ChannelsPanel({ onCloseTab }: { onCloseTab?: () => void }) {
  useChannelsPanel();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    channelsPanel.open();
  }, []);

  const page = channelsPanel.currentPage();

  useEffect(() => {
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page]);

  usePanelEscapeGuard(containerRef, () => {
    if (channelsPanel.back().closePanel) onCloseTab?.();
  });

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      {page.kind === "detail" ? (
        <ChannelDetailPage key={page.channelId} channelId={page.channelId} />
      ) : (
        <ChannelsRootPage />
      )}
    </div>
  );
}
