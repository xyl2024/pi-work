"use client";

// Color icons (have their own fill colors — no background needed)
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import GoogleColorIcon from "@lobehub/icons/es/Google/components/Color";
import DeepSeekColorIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MistralColorIcon from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import MinimaxColorIcon from "@lobehub/icons/es/Minimax/components/Color";
import FireworksColorIcon from "@lobehub/icons/es/Fireworks/components/Color";
import HuggingFaceColorIcon from "@lobehub/icons/es/HuggingFace/components/Color";
import CerebrasColorIcon from "@lobehub/icons/es/Cerebras/components/Color";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import CloudflareColorIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import AwsColorIcon from "@lobehub/icons/es/Aws/components/Color";
import AzureColorIcon from "@lobehub/icons/es/Azure/components/Color";
import KimiColorIcon from "@lobehub/icons/es/Kimi/components/Color";
import QwenColorIcon from "@lobehub/icons/es/Qwen/components/Color";
import ZhipuColorIcon from "@lobehub/icons/es/Zhipu/components/Color";
import CohereColorIcon from "@lobehub/icons/es/Cohere/components/Color";
import PerplexityColorIcon from "@lobehub/icons/es/Perplexity/components/Color";
import TogetherColorIcon from "@lobehub/icons/es/Together/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import NvidiaColorIcon from "@lobehub/icons/es/Nvidia/components/Color";
import BasetenIcon from "@lobehub/icons/es/Baseten/components/Mono";
import AntGroupColorIcon from "@lobehub/icons/es/AntGroup/components/Color";
import XiaomiMiMoIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import {
  isProviderIconPreferred,
  matchModelIcon,
  type ModelIconPreferences,
} from "@/lib/shared/model-icon-match";

type IconComponent = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

// hasColor=true → Color icon (self-colored SVG, no wrapper)
// hasColor=false → Mono icon (rendered with currentColor, inherits theme text color)
const PROVIDER_ICONS: Record<string, { Icon: IconComponent; hasColor: boolean }> = {
  "anthropic":              { Icon: AnthropicIcon,        hasColor: false },
  "openai":                 { Icon: OpenAIIcon,           hasColor: false },
  "openai-codex":           { Icon: OpenAIIcon,           hasColor: false },
  "google":                 { Icon: GoogleColorIcon,      hasColor: true },
  "google-vertex":          { Icon: GoogleColorIcon,      hasColor: true },
  "deepseek":               { Icon: DeepSeekColorIcon,    hasColor: true },
  "groq":                   { Icon: GroqIcon,             hasColor: false },
  "mistral":                { Icon: MistralColorIcon,     hasColor: true },
  "moonshotai":             { Icon: MoonshotIcon,         hasColor: false },
  "moonshotai-cn":          { Icon: MoonshotIcon,         hasColor: false },
  "moonshot":               { Icon: MoonshotIcon,         hasColor: false },
  "minimax":                { Icon: MinimaxColorIcon,     hasColor: true },
  "minimax-cn":             { Icon: MinimaxColorIcon,     hasColor: true },
  "fireworks":              { Icon: FireworksColorIcon,   hasColor: true },
  "huggingface":            { Icon: HuggingFaceColorIcon, hasColor: true },
  "cerebras":               { Icon: CerebrasColorIcon,    hasColor: true },
  "openrouter":             { Icon: OpenRouterIcon,       hasColor: false },
  "xai":                    { Icon: XAIIcon,              hasColor: false },
  "cloudflare-ai-gateway":  { Icon: CloudflareColorIcon,  hasColor: true },
  "cloudflare-workers-ai":  { Icon: CloudflareColorIcon,  hasColor: true },
  "vercel-ai-gateway":      { Icon: VercelIcon,           hasColor: false },
  "github-copilot":         { Icon: GithubCopilotIcon,    hasColor: false },
  "amazon-bedrock":         { Icon: AwsColorIcon,         hasColor: true },
  "azure":                  { Icon: AzureColorIcon,       hasColor: true },
  "kimi-coding":            { Icon: KimiColorIcon,        hasColor: true },
  "qwen":                   { Icon: QwenColorIcon,        hasColor: true },
  "zai":                    { Icon: ZhipuColorIcon,       hasColor: true },
  "cohere":                 { Icon: CohereColorIcon,      hasColor: true },
  "perplexity":             { Icon: PerplexityColorIcon,  hasColor: true },
  "together":               { Icon: TogetherColorIcon,    hasColor: true },
  "grok":                   { Icon: GrokIcon,             hasColor: false },
  // pi builtin providers discovered through runtime catalogs (opencode API,
  // NVIDIA NIM, token plans, ...) — keep in sync with pi-ai's models.generated.js
  "opencode":               { Icon: OpenCodeIcon,         hasColor: false },
  "opencode-go":            { Icon: OpenCodeIcon,         hasColor: false },
  "nvidia":                 { Icon: NvidiaColorIcon,      hasColor: true },
  "baseten":                { Icon: BasetenIcon,          hasColor: false },
  "ant-ling":               { Icon: AntGroupColorIcon,    hasColor: true },
  "xiaomi":                 { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-ams":  { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-cn":   { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-sgp":  { Icon: XiaomiMiMoIcon,       hasColor: false },
  "qwen-token-plan":        { Icon: QwenColorIcon,        hasColor: true },
  "qwen-token-plan-cn":     { Icon: QwenColorIcon,        hasColor: true },
  "qwen-token-plan-individual": { Icon: QwenColorIcon,    hasColor: true },
  "zai-coding-cn":          { Icon: ZhipuColorIcon,       hasColor: true },
};

export function hasProviderIcon(providerId: string | null | undefined): boolean {
  return !!providerId && PROVIDER_ICONS[providerId] !== undefined;
}

/** All provider ids that have an icon — used by the ModelsConfig icon picker. */
export const PROVIDER_ICON_IDS: string[] = Object.keys(PROVIDER_ICONS);

/**
 * The default fallback icon shown when a model has no provider icon and no
 * custom icon. `color` defaults to the muted text colour model cards want;
 * interactive hosts (right-bar button / tab strip) pass `"inherit"` so the
 * glyph follows their active / hover colour like every other panel glyph.
 */
export function ProviderGearIcon({ size, color = "var(--text-muted)" }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color, flexShrink: 0 }}
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}

/**
 * Resolve the icon id to render for a model. Three layers, highest first:
 * 1. An explicit icon configured in ModelsConfig (models.json): the model's
 *    own `icon`, then a bare model id, then the provider-level icon. Values
 *    are provider ids and must exist in the icon library.
 * 2. The icon auto-matched from the model id (see lib/shared/model-icon-match).
 *    Skipped when the icon preference for this model says `provider`.
 * 3. The builtin provider icon (provider-only rows stop here as well).
 * undefined → caller renders the default gear fallback.
 *
 * `preferences` is optional; missing/empty behaves like "no deviations".
 */
export function resolveProviderIcon(
  provider: string | null | undefined,
  model: string | null | undefined,
  modelIcons?: Record<string, string>,
  preferences?: ModelIconPreferences,
): string | undefined {
  if (provider && modelIcons) {
    const iconId = model ? (modelIcons[`${provider}:${model}`] ?? modelIcons[model]) : modelIcons[provider];
    const resolved = iconId ?? modelIcons[provider];
    if (resolved && PROVIDER_ICONS[resolved]) return resolved;
  }
  if (model && !isProviderIconPreferred(preferences, provider, model)) {
    const matched = matchModelIcon(model);
    if (matched && PROVIDER_ICONS[matched]) return matched;
  }
  if (provider && PROVIDER_ICONS[provider]) return provider;
  return undefined;
}

export function ProviderIcon({ id, size, fallback }: { id: string; size: number; fallback?: React.ReactNode }) {
  const pi = PROVIDER_ICONS[id];
  if (!pi) return fallback ?? null;
  // Color icons: self-colored SVG, no wrapper needed
  if (pi.hasColor) return <pi.Icon size={size} />;
  // Mono icons: use currentColor so they adapt to light/dark theme
  return <pi.Icon size={size} style={{ color: "var(--text-muted)" }} />;
}