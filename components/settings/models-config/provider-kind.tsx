import type { ReactNode } from "react";
import {
  MODELS_CONFIG_PROVIDER_KIND_INFO,
  type ModelsConfigProviderKind,
  type ModelsConfigProviderKindInfo,
} from "@/lib/shared/models-config-filter";

function SubscriptionIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ApiKeyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2l-3 3 2 2-2 2-2-2-2 2 2 2" />
    </svg>
  );
}

function CustomIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

export interface ModelsConfigProviderKindView extends ModelsConfigProviderKindInfo {
  Icon: () => ReactNode;
}

export const MODELS_CONFIG_PROVIDER_KIND_VIEW: Record<ModelsConfigProviderKind, ModelsConfigProviderKindView> = {
  subscription: { ...MODELS_CONFIG_PROVIDER_KIND_INFO.subscription, Icon: SubscriptionIcon },
  apiKey: { ...MODELS_CONFIG_PROVIDER_KIND_INFO.apiKey, Icon: ApiKeyIcon },
  custom: { ...MODELS_CONFIG_PROVIDER_KIND_INFO.custom, Icon: CustomIcon },
};
