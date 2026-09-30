"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { SettingsSection } from "../SettingsSection";
import { SaveButton, UnsavedHint } from "../staged-save";
import { SecondaryButton, TextArea, TextInput } from "../controls";
import { isContentEqual } from "@/lib/client/shallowEqual";
import type { SettingsSubmit } from "../use-settings-write";
import type { DirtyReporter } from "../use-unsaved-changes";
import {
  TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLE_NAMES,
  composeSystemPrompt,
  createDefaultTemplate,
  findTemplateWarnings,
  normalizeSystemPromptTemplate,
  renderSystemPromptTemplate,
  type PromptTemplateFragment,
  type TemplateVariableName,
} from "@/lib/shared/system-prompt-template";

/**
 * Section: System prompt template (ADR-0011, spec #99).
 *
 * An ordered fragment list on the left, the rendered prompt on the right. Two
 * things are deliberate:
 *
 * 1. **Staged save** (ADR-0009): a fragment list is structured input the user
 *    composes over several gestures (drag, type, add, remove), so it is an
 *    explicit-save item, not an immediate one. Until Save, nothing is written.
 * 2. **The preview is rendered with the shared pure module** from the variable
 *    bodies `/api/system-prompt-template` reports, so what is shown and what a
 *    session will actually send cannot drift.
 *
 * The template is snapshotted when a session starts; the section says so out
 * loud rather than pretending a running session picks the change up.
 */
export function SystemPromptTemplateSection({
  config,
  submit,
  onDirtyChange,
}: {
  config: { system_prompt_template: PromptTemplateFragment[] };
  submit: SettingsSubmit;
  onDirtyChange?: DirtyReporter;
}) {
  const { t } = useI18n();
  const [fragments, setFragments] = useState<PromptTemplateFragment[]>(() => config.system_prompt_template);
  const [original, setOriginal] = useState<PromptTemplateFragment[]>(() => config.system_prompt_template);
  const [variables, setVariables] = useState<Record<TemplateVariableName, string> | null>(null);
  const [previewCwd, setPreviewCwd] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, flashSavedOk] = useTransientFlag();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const idCounter = useRef(0);

  // Variable bodies come from the live (or most recent) session. Without one the
  // route still answers with real docs paths / date so a template can be built
  // before any session exists.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/system-prompt-template")
      .then((r) => r.json())
      .then((d: { cwd?: string; variables?: Record<TemplateVariableName, string> }) => {
        if (cancelled) return;
        setVariables(d.variables ?? null);
        setPreviewCwd(typeof d.cwd === "string" ? d.cwd : null);
      })
      .catch(() => {
        /* leave the preview in its "unavailable" state */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = !isContentEqual(fragments, original);
  useEffect(() => {
    onDirtyChange?.("system-prompt", dirty);
  }, [dirty, onDirtyChange]);

  const rendered = useMemo(
    () => renderSystemPromptTemplate(fragments, variables ?? {}),
    [fragments, variables],
  );
  const composedPreview = useMemo(
    () => (previewCwd === null ? null : composeSystemPrompt(rendered, previewCwd)),
    [rendered, previewCwd],
  );
  const warnings = useMemo(() => findTemplateWarnings(fragments, rendered), [fragments, rendered]);

  const nextId = (kind: string, existing: readonly PromptTemplateFragment[]) => {
    let id = "";
    do {
      idCounter.current += 1;
      id = `${kind}-${idCounter.current}`;
    } while (existing.some((f) => f.id === id));
    return id;
  };

  const addTextFragment = () =>
    setFragments((prev) => [...prev, { id: nextId("text", prev), kind: "text", text: "" }]);
  const addVariable = (name: TemplateVariableName) =>
    setFragments((prev) => [...prev, { id: nextId("variable", prev), kind: "variable", name }]);
  const removeFragment = (id: string) => setFragments((prev) => prev.filter((f) => f.id !== id));
  const patchFragment = (id: string, patch: Partial<Extract<PromptTemplateFragment, { kind: "text" }>>) =>
    setFragments((prev) => prev.map((f) => (f.id === id && f.kind === "text" ? { ...f, ...patch } : f)));
  const moveFragment = (id: string, direction: -1 | 1) =>
    setFragments((prev) => {
      const index = prev.findIndex((f) => f.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const dropOn = (targetId: string) => {
    const sourceId = draggingId;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;
    setFragments((prev) => {
      const from = prev.findIndex((f) => f.id === sourceId);
      const to = prev.findIndex((f) => f.id === targetId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleSave = useCallback(async () => {
    // The API boundary only checks "is an array"; normalising here keeps a
    // half-typed tag or a blank text fragment from being persisted verbatim.
    const next = normalizeSystemPromptTemplate(fragments);
    setSaving(true);
    const ok = await submit({ system_prompt_template: next }, (prev) => ({
      ...prev,
      system_prompt_template: next,
    }));
    setSaving(false);
    if (ok) {
      setFragments(next);
      setOriginal(next);
      flashSavedOk();
    }
  }, [fragments, submit, flashSavedOk]);

  return (
    <SettingsSection id="system-prompt">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>{t("System Prompt Template")}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UnsavedHint show={dirty} />
          <SaveButton canSave={dirty} saving={saving} saved={savedOk} onClick={handleSave} />
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0", lineHeight: 1.5 }}>
        {t("The system prompt is assembled from this ordered list. Drag to reorder; a text fragment can carry an optional tag. Changes take effect in new sessions only.")}
      </p>
      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
        {t("APPEND_SYSTEM.md is no longer read by Pi Work — the file stays on disk, and anything you want from it has to be copied into a text fragment here. No automatic migration.")}
      </p>

      {/* Fragments */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("Fragments")}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <SecondaryButton onClick={addTextFragment} style={{ height: 26, padding: "4px 10px", fontSize: 11 }}>
            {t("Add text fragment")}
          </SecondaryButton>
          <SecondaryButton
            onClick={() => setFragments(createDefaultTemplate())}
            style={{ height: 26, padding: "4px 10px", fontSize: 11 }}
          >
            {t("Restore default template")}
          </SecondaryButton>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        {fragments.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", fontStyle: "italic" }}>
            {t("No fragments — the rendered prompt will be empty.")}
          </div>
        )}
        {fragments.map((fragment, index) => {
          const label =
            fragment.kind === "variable"
              ? t(TEMPLATE_VARIABLES[fragment.name].labelKey)
              : fragment.tag
                ? `<${fragment.tag}>`
                : t("Text");
          return (
            <div
              key={fragment.id}
              draggable
              onDragStart={() => setDraggingId(fragment.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropOn(fragment.id)}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 8,
                background: draggingId === fragment.id ? "var(--bg-hover)" : "var(--bg)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span title={t("Drag to reorder")} style={{ cursor: "grab", color: "var(--text-dim)", fontSize: 12 }}>⠿</span>
                <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fragment.kind === "variable" ? `${t("Variable")}: ` : `${t("Text")}: `}
                  <span style={{ fontFamily: "var(--font-mono)" }}>{label}</span>
                </span>
                <SecondaryButton
                  onClick={() => moveFragment(fragment.id, -1)}
                  disabled={index === 0}
                  ariaLabel={t("Move up")}
                  style={{ height: 22, padding: "2px 8px", fontSize: 11 }}
                >
                  ↑
                </SecondaryButton>
                <SecondaryButton
                  onClick={() => moveFragment(fragment.id, 1)}
                  disabled={index === fragments.length - 1}
                  ariaLabel={t("Move down")}
                  style={{ height: 22, padding: "2px 8px", fontSize: 11 }}
                >
                  ↓
                </SecondaryButton>
                <SecondaryButton
                  onClick={() => removeFragment(fragment.id)}
                  ariaLabel={t("Remove")}
                  style={{ height: 22, padding: "2px 8px", fontSize: 11 }}
                >
                  ✕
                </SecondaryButton>
              </div>
              {fragment.kind === "variable" ? (
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {t(TEMPLATE_VARIABLES[fragment.name].descriptionKey)}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <TextInput
                    value={fragment.tag ?? ""}
                    onChange={(value) => patchFragment(fragment.id, { tag: value === "" ? undefined : value })}
                    placeholder={t("Optional tag name (renders as <tag>…</tag>)")}
                  />
                  <TextArea
                    value={fragment.text}
                    onChange={(value) => patchFragment(fragment.id, { text: value })}
                    placeholder={t("Text inserted into the system prompt as-is.")}
                    mono
                    style={{ minHeight: 70 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Variable catalog */}
      <details style={{ marginBottom: 14 }}>
        <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
          {t("Available variables")}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
          {TEMPLATE_VARIABLE_NAMES.map((name) => {
            const value = variables?.[name] ?? "";
            return (
              <div key={name} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11 }}>
                <SecondaryButton onClick={() => addVariable(name)} style={{ height: 22, padding: "2px 8px", fontSize: 11 }}>
                  {t("Add")}
                </SecondaryButton>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "var(--text)" }}>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{TEMPLATE_VARIABLES[name].tag ?? "—"}</span>
                    {" · "}
                    {t(TEMPLATE_VARIABLES[name].labelKey)}
                    {" · "}
                    <span style={{ color: "var(--text-dim)" }}>
                      {variables === null ? t("Loading…") : value.trim() === "" ? t("empty") : t("has content")}
                    </span>
                  </div>
                  <div style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>{t(TEMPLATE_VARIABLES[name].descriptionKey)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </details>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ border: "1px solid var(--error, var(--border))", borderRadius: 6, padding: 8, marginBottom: 14 }}>
          {warnings.map((warning) => (
            <div key={warning.code === "empty-render" ? "empty" : warning.variable} style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.5 }}>
              {warning.code === "empty-render"
                ? t("This template renders nothing — the model will lose all of its base guidance.")
                : t("Removed \"{name}\": {effect}", {
                    name: t(TEMPLATE_VARIABLES[warning.variable].labelKey),
                    effect: t(TEMPLATE_VARIABLES[warning.variable].descriptionKey),
                  })}
            </div>
          ))}
        </div>
      )}

      {/* Preview */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("Preview")}</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {t("Variables are read from the live session; without one they are empty.")}
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          maxHeight: 320,
          overflow: "auto",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "var(--text-muted)",
        }}
      >
        {composedPreview === null
          ? t("Loading…")
          : composedPreview.trim() === ""
            ? t("(the rendered prompt is empty)")
            : composedPreview}
      </pre>
    </SettingsSection>
  );
}
