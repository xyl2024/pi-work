"use client";

import type { ReactNode } from "react";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import type { SettingsSectionId } from "./registry";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import type { SettingsApply } from "./use-settings-write";
import type { DirtyReporter } from "./use-unsaved-changes";
import { ProfileSection } from "./sections/ProfileSection";
import { AppendSystemSection } from "./sections/AppendSystemSection";
import { DangerousCommandsSection } from "./sections/DangerousCommandsSection";
import { RightBarSection } from "./sections/RightBarSection";
import { FilePreviewSection } from "./sections/FilePreviewSection";
import { RetrySection } from "./sections/RetrySection";
import { NetworkProxySection } from "./sections/NetworkProxySection";
import { SubagentSection } from "./sections/SubagentSection";
import { SoundSettingsSection } from "./sections/SoundSettingsSection";
import { ToastTestSection } from "./sections/ToastTestSection";
import { AboutSection } from "./sections/AboutSection";

export interface SettingsPageContext {
  config: PiWorkConfig;
  apply: SettingsApply;
  reportDirty: DirtyReporter;
  pageCache: SettingsPageDataCache;
  onProfileSaved?: () => void;
}

export type SettingsPageRenderer = (context: SettingsPageContext) => ReactNode;

export const SETTINGS_PAGES = {
  profile: ({ onProfileSaved, reportDirty }) => (
    <ProfileSection onProfileSaved={onProfileSaved} onDirtyChange={reportDirty} />
  ),
  "right-bar": ({ config, apply }) => <RightBarSection config={config} apply={apply} />,
  "ui-sounds": ({ config, apply }) => <SoundSettingsSection config={config} apply={apply} />,
  "file-preview": ({ config, apply }) => <FilePreviewSection config={config} apply={apply} />,
  "append-system": ({ config, apply, reportDirty, pageCache }) => (
    <AppendSystemSection
      config={config}
      apply={apply}
      onDirtyChange={reportDirty}
      pageCache={pageCache}
    />
  ),
  "dangerous-commands": ({ config, pageCache, reportDirty }) => (
    <DangerousCommandsSection
      config={config}
      pageCache={pageCache}
      onDirtyChange={reportDirty}
    />
  ),
  subagent: ({ pageCache }) => <SubagentSection pageCache={pageCache} />,
  retry: ({ pageCache }) => <RetrySection pageCache={pageCache} />,
  "network-proxy": ({ config, apply, reportDirty }) => (
    <NetworkProxySection config={config} apply={apply} onDirtyChange={reportDirty} />
  ),
  "toast-test": () => <ToastTestSection />,
  about: () => <AboutSection />,
} satisfies Record<SettingsSectionId, SettingsPageRenderer>;
