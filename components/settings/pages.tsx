"use client";

import type { ReactNode } from "react";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import type { SettingsSectionId } from "./registry";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import type { SettingsApply } from "./use-settings-write";
import type { DirtyReporter } from "./use-unsaved-changes";
import { ProfileSection } from "./sections/ProfileSection";
import { AppendSystemSection } from "./sections/AppendSystemSection";
import { MemorySection } from "./sections/MemorySection";
import { DangerousCommandsSection } from "./sections/DangerousCommandsSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { RightBarSection } from "./sections/RightBarSection";
import { AssistantSection } from "./sections/AssistantSection";
import { TextSelectionToolbarSection } from "./sections/TextSelectionToolbarSection";
import { FilePreviewSection } from "./sections/FilePreviewSection";
import { RetrySection } from "./sections/RetrySection";
import { SuggestedPromptSection } from "./sections/SuggestedPromptSection";
import { NetworkProxySection } from "./sections/NetworkProxySection";
import { DeepSeekKeySection } from "./sections/DeepSeekKeySection";
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
  onOpenMemoryPanel?: () => void;
}

export type SettingsPageRenderer = (context: SettingsPageContext) => ReactNode;

export const SETTINGS_PAGES = {
  profile: ({ onProfileSaved, reportDirty }) => (
    <ProfileSection onProfileSaved={onProfileSaved} onDirtyChange={reportDirty} />
  ),
  appearance: () => <AppearanceSection />,
  "right-bar": ({ config, apply }) => <RightBarSection config={config} apply={apply} />,
  assistant: ({ config, apply }) => <AssistantSection config={config} apply={apply} />,
  "text-selection-toolbar": ({ config, apply }) => (
    <TextSelectionToolbarSection config={config} apply={apply} />
  ),
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
  memory: ({ config, apply, pageCache, onOpenMemoryPanel }) => (
    <MemorySection
      config={config}
      apply={apply}
      pageCache={pageCache}
      onOpenMemoryPanel={onOpenMemoryPanel}
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
  "suggested-prompt": ({ config, apply }) => (
    <SuggestedPromptSection config={config} apply={apply} />
  ),
  "network-proxy": ({ config, apply, reportDirty }) => (
    <NetworkProxySection config={config} apply={apply} onDirtyChange={reportDirty} />
  ),
  "deepseek-key": ({ reportDirty }) => (
    <DeepSeekKeySection onDirtyChange={reportDirty} />
  ),
  "toast-test": () => <ToastTestSection />,
  about: () => <AboutSection />,
} satisfies Record<SettingsSectionId, SettingsPageRenderer>;
