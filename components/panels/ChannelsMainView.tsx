"use client";

import { useEffect, useRef } from "react";
import {
  channelsPanel,
  clearChannelSelection,
  discardChannelForm,
  useChannelsPanel,
} from "@/lib/client/channels-panel";
import { requestMainViewLeave } from "@/lib/client/main-view-leave";
import { MainViewMasterDetail } from "./MainViewMasterDetail";
import { ChannelsListPage } from "./channels/ChannelsListPage";
import { ChannelDetailPage } from "./channels/ChannelDetailPage";
import { ChannelFormPage } from "./channels/ChannelFormPage";
import { ChannelCreateGuide, ChannelSelectHint } from "./channels/ChannelEmptyStates";

export function ChannelsMainView({
  onExit,
  visible = true,
}: {
  onExit?: () => void;
  visible?: boolean;
}) {
  const { view } = useChannelsPanel();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    channelsPanel.open();
  }, []);

  const page = channelsPanel.currentPage();
  const { channels, loaded, selectedChannelId } = view;

  const backToBrowse = () => {
    void requestMainViewLeave({ view: "channels", intent: "back_to_browse" }).then((left) => {
      if (left) discardChannelForm();
    });
  };

  const renderDetail = (onBack?: () => void) =>
    !loaded ? null : channels.length === 0 ? (
      <ChannelCreateGuide />
    ) : selectedChannelId === null ? (
      <ChannelSelectHint />
    ) : (
      <ChannelDetailPage key={selectedChannelId} channelId={selectedChannelId} onBack={onBack} />
    );

  return (
    <MainViewMasterDetail
      containerRef={containerRef}
      titleKey={page.kind === "form" ? "New channel" : null}
      onBack={page.kind === "form" ? backToBrowse : null}
      full={page.kind === "form" ? <ChannelFormPage /> : null}
      list={<ChannelsListPage />}
      detail={renderDetail}
      hasDetail={selectedChannelId !== null}
      onClearDetail={clearChannelSelection}
      onExit={onExit}
      visible={visible}
      focusKey={`${page.kind}:${selectedChannelId ?? ""}`}
    />
  );
}
