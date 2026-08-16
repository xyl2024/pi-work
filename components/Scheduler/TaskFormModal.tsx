/**
 * TaskFormModal — create / edit dialog for a single scheduled task.
 *
 * Two-section form (Basic config / Schedule) with a left-side
 * jump nav. The cron editor is the visual CronBuilder; model / thinking /
 * tools are dropdowns mirroring the chat input bar so the UI is consistent
 * across the two surfaces.
 *
 * Wire-up:
 *   - `mode="create"`  — POST /api/scheduled-tasks with `initial`.
 *   - `mode="edit"`    — PATCH /api/scheduled-tasks with `task.id`.
 *
 * The parent owns success/error toasts; we only throw with a friendly
 * error message.
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { ProviderIcon, ProviderGearIcon } from "@/components/ProviderIcon";
import { CwdPicker } from "@/components/CwdPicker";
import { AnimatedPopover } from "@/components/AnimatedPopover";
import { Cron } from "croner";
import { CronBuilder } from "./CronBuilder";
import { apiFetch } from "./utils";
import type { ModelMeta, ScheduledTask, TaskCreatePayload, TaskUpdatePayload } from "./types";
import {
  btnGhost,
  btnPrimary,
  fieldErrorStyle,
  fieldHintStyle,
  fieldLabelStyle,
  inputStyle,
  inputMonoStyle,
  textareaStyle,
} from "./styles";
import { IconClose } from "./icons";

// ── Form state ───────────────────────────────────────────────────

type ToolMode = "all" | "none" | "custom";

interface FormState {
  name: string;
  cron: string;
  cronValid: boolean;
  cwd: string;
  prompt: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  toolMode: ToolMode;
  toolNames: string; // comma-separated
}

const EMPTY: FormState = {
  name: "",
  cron: "0 9 * * *",
  cronValid: true,
  cwd: "",
  prompt: "",
  provider: "",
  modelId: "",
  thinkingLevel: "",
  toolMode: "all",
  toolNames: "",
};

// ── Thinking levels (mirror ChatInput) ──────────────────────────

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const THINKING_COLOR: Record<(typeof THINKING_LEVELS)[number], string> = {
  auto: "var(--text-dim)",
  off: "#94a3b8",
  minimal: "#38bdf8",
  low: "#3b82f6",
  medium: "#8b5cf6",
  high: "#f97316",
  xhigh: "#ef4444",
};

// ── Chat-input-style selector primitives ─────────────────────────
//
// The model / thinking / tools controls reuse the chat input bar's pill
// language: a borderless rounded trigger (hover/selected background only)
// with an AnimatedPopover panel using the same chrome (bg-panel, 10px
// radius, deep shadow). The cwd control reuses the actual CwdPicker used
// in ChatInput.

/** Trigger pill matching ChatInput's model/thinking/tools buttons. */
function pillTriggerStyle(open: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    height: 32,
    padding: "0 10px",
    boxSizing: "border-box",
    background: open ? "var(--bg-hover)" : "none",
    border: "none",
    borderRadius: 9,
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
    transition: "background 0.12s, color 0.12s",
    overflow: "hidden",
  };
}

/** Dropdown panel chrome matching ChatInput's AnimatedPopover panels. */
const dropdownPanelStyle: CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  left: 0,
  right: 0,
  zIndex: 1100,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
};

/** Option row matching ChatInput dropdown rows. */
function dropdownOptionStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 12px",
    background: active ? "var(--bg-selected)" : "none",
    border: "none",
    color: active ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
    fontWeight: active ? 600 : 400,
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  };
}

/** Open state + outside-click close for one dropdown trigger. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return { open, setOpen, rootRef };
}

/** Active checkmark / inactive spacer — ChatInput's row leading column. */
function CheckOrGap({ active }: { active: boolean }) {
  return active ? (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="1.5 5 4 7.5 8.5 2.5" />
    </svg>
  ) : (
    <span style={{ width: 10, flexShrink: 0 }} />
  );
}

/** Lightbulb icon — same glyph as ChatInput's thinking trigger. */
function ThinkingIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
      <line x1="7" y1="18" x2="12" y2="18" />
      <line x1="8" y1="21" x2="11" y2="21" />
    </svg>
  );
}

/** Wrench icon — same glyph as ChatInput's tools trigger. */
function ToolsIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

// ── Props ────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  /** Existing task to edit. `null` ⇒ create mode. */
  task: ScheduledTask | null;
  /** Optional prefill for create mode (cwd hint from the active session). */
  initialCwd?: string;
  meta: ModelMeta | null;
  onClose: () => void;
  /** Called after a successful save with the new/updated task id. */
  onSaved: (taskId: string) => Promise<void> | void;
  onToast: (kind: "success" | "error", message: string) => void;
}

// ── Component ────────────────────────────────────────────────────

export function TaskFormModal({ open, task, initialCwd, meta, onClose, onSaved, onToast }: Props) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({ isOpen: open, onClose });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<"basics" | "schedule">("basics");
  /** Validation errors are suppressed until the user first clicks Save;
   *  flipping this on reveals field red-text and the per-section nav dots. */
  const [submitted, setSubmitted] = useState(false);

  // Initial / reset form whenever the open state changes (a different
  // task, or a fresh create).
  useEffect(() => {
    if (!open) return;
    if (task) {
      const toolNames = task.toolNames ?? [];
      setForm({
        name: task.name,
        cron: task.cron,
        cronValid: (() => { try { new Cron(task.cron); return true; } catch { return false; } })(),
        cwd: task.cwd,
        prompt: task.prompt,
        provider: task.provider ?? "",
        modelId: task.modelId ?? "",
        thinkingLevel: task.thinkingLevel ?? "",
        toolMode: task.toolNames === null ? "all" : toolNames.length === 0 ? "none" : "custom",
        toolNames: toolNames.join(", "),
      });
    } else {
      setForm({ ...EMPTY, cwd: initialCwd ?? "" });
    }
    setSection("basics");
    setSubmitted(false);
  }, [open, task, initialCwd]);

  if (!isVisible) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const nameError = submitted && form.name.trim().length === 0 ? t("Please enter a task name") : null;
  const cwdError = submitted && form.cwd.trim().length === 0 ? t("Please enter a working directory") : null;
  const promptError = submitted && form.prompt.trim().length === 0 ? t("Please enter a prompt") : null;
  // Cron builder has its own inline error (red border + syntax-error label) that
  // shows immediately while the user is editing — this is builder-internal
  // feedback, not form-level required-field validation, so it's intentional
  // that it surfaces before submit.
  const cronError = submitted && !form.cronValid ? t("Schedule syntax error") : null;
  const errors: Record<string, string | null> = {
    basics: nameError ?? promptError ?? cwdError,
    schedule: cronError,
  };

  const submit = async () => {
    if (saving) return;
    // First click reveals validation; subsequent edits keep the red text
    // visible until the next successful submit (which closes the modal).
    setSubmitted(true);
    const hasError = !form.name.trim() || !form.cwd.trim() || !form.prompt.trim() || !form.cronValid;
    if (hasError) {
      onToast("error", t("Please fix form errors first"));
      // Jump to the first section that has an error
      const firstError = (["basics", "schedule"] as const).find((s) => {
        if (s === "basics") return !form.name.trim() || !form.prompt.trim() || !form.cwd.trim();
        if (s === "schedule") return !form.cronValid;
        return false;
      });
      if (firstError) setSection(firstError);
      return;
    }
    setSaving(true);
    try {
      let toolNames: string[] | null;
      if (form.toolMode === "all") toolNames = null;
      else if (form.toolMode === "none") toolNames = [];
      else toolNames = form.toolNames.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

      const body: TaskCreatePayload | TaskUpdatePayload = {
        name: form.name.trim(),
        cron: form.cron.trim(),
        cwd: form.cwd.trim(),
        prompt: form.prompt.trim(),
        provider: form.provider.trim() || null,
        modelId: form.modelId.trim() || null,
        thinkingLevel: form.thinkingLevel.trim() || null,
        toolNames: form.toolMode === "custom" && toolNames && toolNames.length > 0 ? toolNames : toolNames ?? null,
      };

      let saved: { task: ScheduledTask };
      if (task) {
        saved = await apiFetch<{ task: ScheduledTask }>("/api/scheduled-tasks", {
          method: "PATCH",
          body: JSON.stringify({ id: task.id, ...body }),
        });
        onToast("success", t("Task updated"));
      } else {
        saved = await apiFetch<{ task: ScheduledTask }>("/api/scheduled-tasks", {
          method: "POST",
          body: JSON.stringify(body),
        });
        onToast("success", t("Task created"));
      }
      await onSaved(saved.task.id);
      requestClose();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : t("Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={backdropStyle}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        style={{
          ...panelStyle,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 760,
          maxWidth: "94vw",
          height: "84vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {task ? t("Edit task") : t("New task")}
          </span>
          <button
            onClick={requestClose}
            aria-label={t("Close")}
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", padding: "2px 6px", lineHeight: 1,
            }}
          >
            <IconClose width={16} height={16} />
          </button>
        </div>

        {/* Body: nav + form */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Section nav */}
          <nav
            style={{
              width: 160,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              padding: "16px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              background: "var(--bg-panel)",
            }}
          >
            {([
              { id: "basics", label: t("Basic config") },
              { id: "schedule", label: t("Scheduler") },
            ] as const).map((s) => {
              const err = errors[s.id];
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 10px",
                    borderRadius: 6,
                    background: active ? "var(--bg-selected)" : "transparent",
                    color: active ? "var(--text)" : err ? "var(--error)" : "var(--text-muted)",
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: err ? "var(--error)" : active ? "var(--accent)" : "var(--border)",
                    flexShrink: 0,
                  }} />
                  <span style={{ flex: 1 }}>{s.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Form scroll */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            {section === "basics" && (
              <BasicConfigSection form={form} update={update} meta={meta} errors={{ name: nameError, prompt: promptError, cwd: cwdError }} />
            )}
            {section === "schedule" && (
              <ScheduleSection form={form} update={update} cronError={cronError} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={requestClose} disabled={saving} style={btnGhost}>{t("Cancel")}</button>
            <button onClick={() => void submit()} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
              {saving ? t("Saving...") : task ? t("Save changes") : t("Create & enable")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sections ─────────────────────────────────────────────────────

function BasicConfigSection({ form, update, meta, errors }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void; meta: ModelMeta | null; errors: { name: string | null; prompt: string | null; cwd: string | null } }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label={t("Task name")} hint={t("Concise description, e.g. daily report")} error={errors.name}>
        <input
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder={t("e.g. daily report")}
          autoFocus
          className="scheduler-text-input"
          style={inputStyle}
        />
      </Field>
      <Field label={t("Prompt")} hint={t("Full prompt sent to agent at trigger time")} error={errors.prompt}>
        <textarea
          value={form.prompt}
          onChange={(e) => update("prompt", e.target.value)}
          rows={8}
          placeholder={t("Check yesterday's PRs for unhandled comments and summarize...")}
          className="scheduler-text-input"
          style={textareaStyle}
        />
      </Field>
      {/* The four runtime selectors sit in a 2×2 grid, mirroring the chat
          input bar's pills (cwd + model on the first row, thinking + tools
          on the second). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 14px" }}>
        <Field label={t("Working directory")} hint={t("The cwd the agent runs in; must exist")} error={errors.cwd}>
          <CwdPicker
            cwd={form.cwd || null}
            onCwdChange={(c) => update("cwd", c)}
            fill
          />
        </Field>
        <ModelSelect form={form} update={update} meta={meta} />
        <ThinkingSelect form={form} update={update} meta={meta} />
        <ToolsSelect form={form} update={update} />
      </div>
    </div>
  );
}

function ScheduleSection({ form, update, cronError }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void; cronError: string | null }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label={t("Cron expression")} hint={t("Cron examples hint")} error={cronError}>
        <CronBuilder
          value={form.cron}
          onChange={(cron, valid) => {
            update("cron", cron);
            update("cronValid", valid);
          }}
        />
      </Field>
    </div>
  );
}


function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      {children}
      {error && <div style={fieldErrorStyle}>{error}</div>}
      {!error && hint && <div style={fieldHintStyle}>{hint}</div>}
    </div>
  );
}

// ── Selector sub-components (mirror ChatInput style) ─────────────

function ModelSelect({ form, update, meta }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void; meta: ModelMeta | null }) {
  const { t } = useI18n();
  const options = meta?.modelList ?? [];
  const isDefault = !form.provider && !form.modelId;
  const current = options.find((o) => o.provider === form.provider && o.id === form.modelId);
  const groups: { provider: string; options: typeof options }[] = [];
  for (const opt of options) {
    const g = groups.find((x) => x.provider === opt.provider);
    if (g) g.options.push(opt);
    else groups.push({ provider: opt.provider, options: [opt] });
  }
  const { open, setOpen, rootRef } = useDropdown();

  return (
    <Field label={t("Model")} hint={t("Leave empty to use the default model")}>
      <div ref={rootRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={pillTriggerStyle(open)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = open ? "var(--bg-hover)" : "none";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <ProviderIcon
            id={current?.provider ?? ""}
            size={12}
            fallback={<ProviderGearIcon size={11} />}
          />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
            {isDefault ? (
              <>
                {t("Default model")}
                {meta?.defaultModel && (
                  <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 6 }}>
                    {meta.defaultModel.modelId}
                  </span>
                )}
              </>
            ) : current?.name ?? `${form.provider}/${form.modelId}`}
          </span>
        </button>
        <AnimatedPopover open={open} style={dropdownPanelStyle} maxHeight={320}>
          <button
            type="button"
            onClick={() => {
              update("provider", "");
              update("modelId", "");
              setOpen(false);
            }}
            style={dropdownOptionStyle(isDefault)}
          >
            <CheckOrGap active={isDefault} />
            <span style={{ flex: 1 }}>{t("Default model")}</span>
            {meta?.defaultModel && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {meta.defaultModel.modelId}
              </span>
            )}
          </button>
          {groups.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
              {groups.map((g) => (
                <div key={g.provider}>
                  <div style={{ padding: "4px 10px", fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {g.provider}
                  </div>
                  {g.options.map((opt) => {
                    const active = opt.provider === form.provider && opt.id === form.modelId;
                    return (
                      <button
                        key={`${opt.provider}:${opt.id}`}
                        type="button"
                        onClick={() => {
                          update("provider", opt.provider);
                          update("modelId", opt.id);
                          setOpen(false);
                        }}
                        style={dropdownOptionStyle(active)}
                      >
                        <CheckOrGap active={active} />
                        <ProviderIcon id={opt.provider} size={11} fallback={<span style={{ width: 11 }} />} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{opt.name}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </AnimatedPopover>
      </div>
    </Field>
  );
}

function ThinkingSelect({ form, update, meta }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void; meta: ModelMeta | null }) {
  const { t } = useI18n();
  const key = form.provider && form.modelId ? `${form.provider}:${form.modelId}` : null;
  const available = key ? meta?.thinkingLevels[key] : undefined;
  const levelMap = key ? meta?.thinkingLevelMaps[key] : undefined;
  const current = (form.thinkingLevel || "auto") as (typeof THINKING_LEVELS)[number];
  const { open, setOpen, rootRef } = useDropdown();
  const currentMapped = current !== "auto" && levelMap ? levelMap[current] : undefined;
  const displayLabel = (currentMapped != null && currentMapped !== current)
    ? currentMapped
    : current === "auto" ? t("Use model default") : current;

  return (
    <Field label={t("Thinking level")} hint={t("auto uses the model default")}>
      <div ref={rootRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            ...pillTriggerStyle(open),
            color: THINKING_COLOR[current],
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = open ? "var(--bg-hover)" : "none"; }}
        >
          <ThinkingIcon />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
            {displayLabel}
          </span>
        </button>
        <AnimatedPopover open={open} style={dropdownPanelStyle} maxHeight={320}>
          {THINKING_LEVELS.filter((lvl) => {
            if (lvl === "auto") return true;
            if (!available) return true;
            return available.includes(lvl);
          }).map((lvl) => {
            const active = current === lvl;
            const mappedVal = lvl !== "auto" && levelMap ? levelMap[lvl] : undefined;
            const label = mappedVal != null && mappedVal !== lvl ? mappedVal : lvl;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => {
                  update("thinkingLevel", lvl === "auto" ? "" : lvl);
                  setOpen(false);
                }}
                style={dropdownOptionStyle(active)}
              >
                <CheckOrGap active={active} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: THINKING_COLOR[lvl], flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{lvl === "auto" ? t("Use model default") : label}</span>
                {mappedVal != null && mappedVal !== lvl && (
                  <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>({lvl})</span>
                )}
              </button>
            );
          })}
        </AnimatedPopover>
      </div>
    </Field>
  );
}

function ToolsSelect({ form, update }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const { t } = useI18n();
  const modes: { id: ToolMode; label: string; desc: string }[] = [
    { id: "all",    label: t("All tools"),     desc: t("Use all available tools") },
    { id: "none",   label: t("No tools"),      desc: t("Chat only, no commands") },
    { id: "custom", label: t("Custom"),        desc: t("Specify a list of tool names") },
  ];
  const { open, setOpen, rootRef } = useDropdown();
  const triggerLabel = form.toolMode === "all"
    ? t("All tools")
    : form.toolMode === "none"
      ? t("No tools")
      : form.toolNames.trim() || t("Custom (empty)");

  return (
    <Field label={t("Tool set")} hint={t("all: all tools, none: chat only, custom: comma-separated tool names")}>
      <div ref={rootRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={pillTriggerStyle(open)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = open ? "var(--bg-hover)" : "none";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <ToolsIcon />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
            {triggerLabel}
          </span>
        </button>
        <AnimatedPopover open={open} style={dropdownPanelStyle} maxHeight={320}>
          {modes.map((m) => {
            const active = form.toolMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  update("toolMode", m.id);
                  // Custom keeps the panel open so the user can immediately
                  // type tool names (mirrors ChatInput's expandable Custom row).
                  if (m.id !== "custom") setOpen(false);
                }}
                style={dropdownOptionStyle(active)}
              >
                <CheckOrGap active={active} />
                <span style={{ flex: 1 }}>{m.label}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{m.desc}</span>
              </button>
            );
          })}
          {form.toolMode === "custom" && (
            <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border)", marginTop: 4 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("Comma-separated tool names")}</div>
              <input
                value={form.toolNames}
                onChange={(e) => update("toolNames", e.target.value)}
                placeholder="bash, file_write, agent_todo"
                className="scheduler-text-input"
                style={inputMonoStyle}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </AnimatedPopover>
      </div>
    </Field>
  );
}