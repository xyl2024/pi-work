"use client";

/**
 * SubagentEditor — create or edit one subagent profile.
 *
 * A portal modal (so it escapes the settings modal's scroll container) with
 * every profile field: name, description, system prompt, tools, model,
 * thinking level, timeout and the Pi Bot appearance. Writes immediately via
 * `/api/subagents` on Save; the caller refreshes the list and the client
 * profile cache.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import {
  DEFAULT_SUBAGENT_BOT,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  MAX_SUBAGENT_TIMEOUT_MS,
  MIN_SUBAGENT_TIMEOUT_MS,
  SUBAGENT_DESCRIPTION_MAX,
  SUBAGENT_DEFAULT_TOOL_IDS,
  SUBAGENT_THINKING_LEVELS,
  isValidSubagentName,
  type SubagentBotAppearance,
  type SubagentProfile,
  type SubagentThinkingLevel,
} from "@/lib/shared/subagent";
import { PrimaryButton, SecondaryButton, TextArea, TextInput, Field, GroupedSelect, Select, NumInput } from "../controls";
import { BotAppearancePicker } from "./BotAppearancePicker";
import { SubagentToolPicker } from "./SubagentToolPicker";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface Draft {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model: { provider: string; modelId: string } | null;
  thinkingLevel: SubagentThinkingLevel;
  bot: SubagentBotAppearance;
  timeoutMinutes: string;
}

function draftFromProfile(profile: SubagentProfile | null): Draft {
  if (!profile) {
    return {
      name: "",
      description: "",
      systemPrompt: "",
      tools: [...SUBAGENT_DEFAULT_TOOL_IDS, "bash", "powershell"],
      model: null,
      thinkingLevel: "off",
      bot: { ...DEFAULT_SUBAGENT_BOT },
      timeoutMinutes: String(Math.round(DEFAULT_SUBAGENT_TIMEOUT_MS / 60_000)),
    };
  }
  return {
    name: profile.name,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    tools: [...profile.tools],
    model: profile.model ? { ...profile.model } : null,
    thinkingLevel: profile.thinkingLevel,
    bot: { ...profile.bot, parts: [...profile.bot.parts], accessories: [...profile.bot.accessories] },
    timeoutMinutes: String(Math.round(profile.timeoutMs / 60_000)),
  };
}

export function SubagentEditor({
  profile,
  onClose,
  onSaved,
}: {
  /** null = create a new profile. */
  profile: SubagentProfile | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const isNew = profile === null;
  const [draft, setDraft] = useState<Draft>(() => draftFromProfile(profile));
  const [models, setModels] = useState<ModelOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => { setPortalEl(document.body); }, []);
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({
    isOpen: portalEl !== null,
    onClose,
    backdropAlpha: 0.4,
  });
  useBodyScrollLock(isVisible);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((response) => response.json())
      .then((data: { modelList?: ModelOption[] }) => {
        if (!cancelled) setModels(data.modelList ?? []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models) {
      const group = groups.get(model.provider) ?? [];
      group.push(model);
      groups.set(model.provider, group);
    }
    return [...groups.entries()];
  }, [models]);

  const modelValue = draft.model ? `${draft.model.provider}:${draft.model.modelId}` : "inherit";

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

  const save = async () => {
    setError(null);
    if (!isValidSubagentName(draft.name.trim())) {
      setError(t("Name must start with a lowercase letter and use only lowercase letters, digits, '_' or '-'."));
      return;
    }
    if (!draft.description.trim()) {
      setError(t("Description is required."));
      return;
    }
    if (!draft.systemPrompt.trim()) {
      setError(t("System prompt is required."));
      return;
    }
    const timeoutMinutes = Number(draft.timeoutMinutes);
    const timeoutMs = Math.round(timeoutMinutes * 60_000);
    if (!Number.isFinite(timeoutMinutes) || timeoutMs < MIN_SUBAGENT_TIMEOUT_MS || timeoutMs > MAX_SUBAGENT_TIMEOUT_MS) {
      setError(t("Timeout must be between {min} and {max} minutes.", {
        min: Math.ceil(MIN_SUBAGENT_TIMEOUT_MS / 60_000),
        max: Math.round(MAX_SUBAGENT_TIMEOUT_MS / 60_000),
      }));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        systemPrompt: draft.systemPrompt,
        tools: draft.tools,
        model: draft.model,
        thinkingLevel: draft.thinkingLevel,
        bot: draft.bot,
        timeoutMs,
      };
      const response = await fetch("/api/subagents", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? t("Failed to save subagent"));
        return;
      }
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (!isVisible || !portalEl) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? t("New subagent") : t("Edit subagent")}
      style={backdropStyle}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <div
        style={{
          ...panelStyle,
          width: "min(860px, calc(100vw - 32px))",
          maxHeight: "min(860px, calc(100vh - 48px))",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{isNew ? t("New subagent") : t("Edit subagent")}</span>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t("Close")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "none", border: "none", borderRadius: 6, color: "var(--text-dim)", cursor: "pointer" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="20" y2="20" /><line x1="20" y1="4" x2="4" y2="20" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={t("Name")} hint={t("The model passes this as subagent_name. Immutable after creation.")}>
              <TextInput
                value={draft.name}
                onChange={(value) => patch({ name: value })}
                placeholder="codebase_explorer"
                mono
                disabled={!isNew}
                maxLength={64}
              />
            </Field>
            <Field label={t("Model")}>
              <GroupedSelect
                value={modelValue}
                disabled={models.length === 0}
                leadingOption={{ value: "inherit", label: t("Inherit parent model") }}
                groups={groupedModels.map(([provider, providerModels]) => ({
                  label: provider,
                  options: providerModels.map((model) => ({ value: `${model.provider}:${model.id}`, label: model.name })),
                }))}
                onChange={(value) => {
                  if (value === "inherit") { patch({ model: null }); return; }
                  const [provider, ...id] = value.split(":");
                  patch({ model: { provider, modelId: id.join(":") } });
                }}
              />
            </Field>
          </div>

          <Field label={t("Description")} hint={t("Shown to the parent model so it knows when to use this subagent.")}>
            <TextInput
              value={draft.description}
              onChange={(value) => patch({ description: value })}
              maxLength={SUBAGENT_DESCRIPTION_MAX}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={t("Subagent thinking level")}>
              <Select
                value={draft.thinkingLevel}
                required
                options={SUBAGENT_THINKING_LEVELS}
                onChange={(value) => patch({ thinkingLevel: value as SubagentThinkingLevel })}
              />
            </Field>
            <Field label={t("Timeout (minutes)")} hint={t("The child run is stopped when it exceeds this.")}>
              <NumInput
                value={draft.timeoutMinutes}
                onChange={(value) => patch({ timeoutMinutes: value })}
                placeholder="15"
              />
            </Field>
          </div>

          <Field label={t("System prompt")}>
            <TextArea
              value={draft.systemPrompt}
              onChange={(value) => patch({ systemPrompt: value })}
              mono
              style={{ minHeight: 160, fontSize: 12 }}
              placeholder={t("You are now in …")}
            />
          </Field>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: -8 }}>
            {t("The child's working directory is appended automatically at run time.")}
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("Tools")}</div>
            <SubagentToolPicker value={draft.tools} onChange={(tools) => patch({ tools })} />
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("Pi Bot appearance")}</div>
            <BotAppearancePicker value={draft.bot} onChange={(bot) => patch({ bot })} />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: "var(--error)", padding: "8px 10px", border: "1px solid var(--error)", borderRadius: 8 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <SecondaryButton onClick={requestClose} disabled={saving}>{t("Cancel")}</SecondaryButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}>{saving ? t("Saving...") : t("Save")}</PrimaryButton>
        </div>
      </div>
    </div>,
    portalEl,
  );
}
