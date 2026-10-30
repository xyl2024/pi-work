"use client";

import { useEffect, useRef } from "react";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { currentChannelsPage } from "@/lib/shared/channels-pages";
import {
  ensureChannelsLoaded,
  escapeChannels,
  useChannelsStore,
} from "@/lib/client/channels-store";
import { ChannelsRootPage } from "./channels/ChannelsRootPage";
import { ChannelDetailPage } from "./channels/ChannelDetailPage";

export function ChannelsPanel({ onCloseTab }: { onCloseTab?: () => void }) {
  const { pages } = useChannelsStore();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureChannelsLoaded();
  }, []);

  const page = currentChannelsPage(pages);

  useEffect(() => {
    const el = containerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [page]);

  usePanelEscapeGuard(containerRef, () => {
    if (escapeChannels().closePanel) onCloseTab?.();
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
