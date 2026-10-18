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

/**
 * The 频道 panel view body.
 *
 * The panel card only mounts the active tab's body, so this component owns no
 * page state: the list, the selection, the page stack, the create draft and —
 * once the scan login is wired (ticket #141) — the live login phase all live in
 * `lib/client/channels-store.ts`. Here it wires the first read on entry,
 * dispatches the current page to a full-width view, and turns Escape into "up
 * one level" — falling back to the panel tab's close rule from the list.
 */
export function ChannelsPanel({ onCloseTab }: { onCloseTab?: () => void }) {
  const { pages } = useChannelsStore();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureChannelsLoaded();
  }, []);

  const page = currentChannelsPage(pages);

  // Focus is kept inside the panel while it is the active surface, so a
  // palette / dialog that has taken focus keeps its own Escape.
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
        // Remounting on channelId keeps the detail page's own state (rename
        // input, workspace menu) scoped to the channel actually on screen when
        // one detail page replaces another.
        <ChannelDetailPage key={page.channelId} channelId={page.channelId} />
      ) : (
        <ChannelsRootPage />
      )}
    </div>
  );
}
