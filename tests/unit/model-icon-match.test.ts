import { describe, expect, it } from "vitest";
import {
  MODEL_ICON_PREFERENCE_PROVIDER,
  canToggleModelIcon,
  isProviderIconPreferred,
  matchModelIcon,
  modelIconPreferenceKey,
} from "@/lib/shared/model-icon-match";
import { resolveProviderIcon } from "@/components/ui/ProviderIcon";

/**
 * Model icon auto-match (lib/shared/model-icon-match.ts) and the three-layer
 * resolution in resolveProviderIcon (components/ui/ProviderIcon.tsx). Driven
 * as plain data — no DOM, no fetch. Expected icon ids are the icon library's
 * provider ids, written as literals from the spec.
 */

describe("matchModelIcon", () => {
  it.each([
    ["claude-sonnet-4-5", "anthropic"],
    ["gpt-5", "openai"],
    ["gemini-2.5-pro", "google"],
    ["deepseek-chat", "deepseek"],
    ["glm-4.6", "zai"],
    ["kimi-k2", "moonshotai"],
    ["qwen3-max", "qwen"],
    ["minimax-m2", "minimax"],
    ["mistral-large", "mistral"],
    ["grok-4", "xai"],
  ])("matches the brand prefix of %s", (modelId, iconId) => {
    expect(matchModelIcon(modelId)).toBe(iconId);
  });

  it("matches brand aliases that are not a plain prefix", () => {
    expect(matchModelIcon("codex-mini")).toBe("openai");
    expect(matchModelIcon("chatgpt-4o")).toBe("openai");
    expect(matchModelIcon("chatglm-4")).toBe("zai");
    expect(matchModelIcon("moonshot-v1")).toBe("moonshotai");
    expect(matchModelIcon("qwq-32b")).toBe("qwen");
    expect(matchModelIcon("abab-6.5")).toBe("minimax");
    expect(matchModelIcon("mixtral-8x7b")).toBe("mistral");
  });

  it("matches the bare o-series aliases without swallowing openrouter", () => {
    expect(matchModelIcon("o3")).toBe("openai");
    expect(matchModelIcon("o4")).toBe("openai");
    expect(matchModelIcon("o1")).toBe("openai");
    expect(matchModelIcon("openrouter/auto")).toBeUndefined();
  });

  it("normalizes case", () => {
    expect(matchModelIcon("GPT-5")).toBe("openai");
    expect(matchModelIcon("Claude-Opus-4")).toBe("anthropic");
    expect(matchModelIcon("  Qwen3  ")).toBe("qwen");
  });

  it("always yields the main brand icon, never a coding / token-plan / cn variant", () => {
    expect(matchModelIcon("kimi-k2")).toBe("moonshotai");
    expect(matchModelIcon("glm-4.6")).toBe("zai");
    expect(matchModelIcon("qwen3-coder")).toBe("qwen");
    expect(matchModelIcon("minimax-m2")).toBe("minimax");
  });

  it("does not match families outside the icon library", () => {
    expect(matchModelIcon("llama-3.1-70b")).toBeUndefined();
    expect(matchModelIcon("meta-llama-3")).toBeUndefined();
    expect(matchModelIcon("some-custom-model")).toBeUndefined();
    expect(matchModelIcon("")).toBeUndefined();
    expect(matchModelIcon(null)).toBeUndefined();
    expect(matchModelIcon(undefined)).toBeUndefined();
  });
});

describe("icon preference", () => {
  it("keys deviations by provider:modelId", () => {
    expect(modelIconPreferenceKey("github-copilot", "claude-sonnet-4")).toBe(
      "github-copilot:claude-sonnet-4",
    );
  });

  it("treats only an explicit provider value as a deviation", () => {
    const preferences = {
      [`github-copilot:claude-sonnet-4`]: MODEL_ICON_PREFERENCE_PROVIDER,
      [`github-copilot:gpt-5`]: "anthropic",
    };
    expect(isProviderIconPreferred(preferences, "github-copilot", "claude-sonnet-4")).toBe(true);
    // Unknown values fall back to "no deviation".
    expect(isProviderIconPreferred(preferences, "github-copilot", "gpt-5")).toBe(false);
    expect(isProviderIconPreferred(preferences, "github-copilot", "gemini-2.5-pro")).toBe(false);
  });

  it("is false without preferences or without a provider/model pair", () => {
    expect(isProviderIconPreferred(undefined, "github-copilot", "claude-sonnet-4")).toBe(false);
    expect(isProviderIconPreferred({}, "github-copilot", "claude-sonnet-4")).toBe(false);
    expect(
      isProviderIconPreferred(
        { [`github-copilot:claude-sonnet-4`]: MODEL_ICON_PREFERENCE_PROVIDER },
        "github-copilot",
        undefined,
      ),
    ).toBe(false);
    expect(isProviderIconPreferred(undefined, undefined, "claude-sonnet-4")).toBe(false);
  });

  it("offers a toggle only when the match exists and differs from the provider icon", () => {
    expect(canToggleModelIcon("claude-sonnet-4", "github-copilot")).toBe(true);
    expect(canToggleModelIcon("claude-sonnet-4", undefined)).toBe(true);
    // Same icon on both sides → nothing to toggle.
    expect(canToggleModelIcon("gpt-4o", "openai")).toBe(false);
    expect(canToggleModelIcon("GPT-5", "openai")).toBe(false);
    // No auto match (or no model, i.e. a provider-only row) → no toggle.
    expect(canToggleModelIcon("llama-3.1", "groq")).toBe(false);
    expect(canToggleModelIcon(undefined, "openai")).toBe(false);
    expect(canToggleModelIcon(null, "openai")).toBe(false);
  });
});

describe("resolveProviderIcon", () => {
  it("keeps the provider icon when nothing is configured or matched", () => {
    expect(resolveProviderIcon("openai", "gpt-4o")).toBe("openai");
    expect(resolveProviderIcon("openai", undefined)).toBe("openai");
    expect(resolveProviderIcon("openai", undefined, {})).toBe("openai");
    expect(resolveProviderIcon("unknown-provider", "unknown-model")).toBeUndefined();
  });

  it("auto-matches a model id onto its brand icon", () => {
    expect(resolveProviderIcon("github-copilot", "claude-sonnet-4-5")).toBe("anthropic");
    expect(resolveProviderIcon("my-gateway", "gpt-4o")).toBe("openai");
    expect(resolveProviderIcon("my-gateway", "GLM-4.6")).toBe("zai");
  });

  it("falls back to the provider icon when the model does not match", () => {
    expect(resolveProviderIcon("github-copilot", "llama-3.1")).toBe("github-copilot");
    expect(resolveProviderIcon("my-gateway", "llama-3.1")).toBeUndefined();
  });

  it("lets an explicit model-level icon win over the auto match (builtin providers included)", () => {
    expect(
      resolveProviderIcon("github-copilot", "claude-sonnet-4-5", {
        "github-copilot:claude-sonnet-4-5": "deepseek",
      }),
    ).toBe("deepseek");
    // Bare model id and provider-level entries still act as fallbacks.
    expect(
      resolveProviderIcon("github-copilot", "claude-sonnet-4-5", { "claude-sonnet-4-5": "mistral" }),
    ).toBe("mistral");
    expect(resolveProviderIcon("my-gateway", "claude-sonnet-4-5", { "my-gateway": "xai" })).toBe("xai");
  });

  it("skips the auto match when the preference says provider, but explicit icons still win", () => {
    const modelId = "claude-sonnet-4-5";
    const preferences = { [`github-copilot:${modelId}`]: MODEL_ICON_PREFERENCE_PROVIDER };
    expect(resolveProviderIcon("github-copilot", modelId, undefined, preferences)).toBe("github-copilot");
    expect(
      resolveProviderIcon("github-copilot", modelId, { [`github-copilot:${modelId}`]: "deepseek" }, preferences),
    ).toBe("deepseek");
  });

  it("uses the auto match when the preference is missing or says something else", () => {
    const modelId = "claude-sonnet-4-5";
    expect(resolveProviderIcon("github-copilot", modelId, undefined, {})).toBe("anthropic");
    expect(
      resolveProviderIcon("github-copilot", modelId, undefined, { [`github-copilot:${modelId}`]: "anthropic" }),
    ).toBe("anthropic");
    // Another model's preference does not leak over.
    expect(
      resolveProviderIcon("github-copilot", modelId, undefined, { "github-copilot:gpt-5": "provider" }),
    ).toBe("anthropic");
  });

  it("keeps provider-only rows on the provider icon, still honoring an explicit provider-level icon", () => {
    expect(resolveProviderIcon("github-copilot", undefined)).toBe("github-copilot");
    expect(resolveProviderIcon("my-gateway", undefined, { "my-gateway": "deepseek" })).toBe("deepseek");
    expect(
      resolveProviderIcon("github-copilot", undefined, undefined, {
        "github-copilot:claude-sonnet-4-5": MODEL_ICON_PREFERENCE_PROVIDER,
      }),
    ).toBe("github-copilot");
  });
});
