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

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "@/components/ui/icons";
import { ModelPickerModal } from "@/components/chat/ModelPickerModal";
import { CwdPicker } from "@/components/sessions/CwdPicker";
import { AnimatedPopover } from "@/components/ui/AnimatedPopover";
import { Cron } from "croner";
import { CronBuilder } from "./CronBuilder";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { apiFetch } from "./utils";
import { pickClosestAvailableThinkingLevel, THINKING_LEVEL_ORDER } from "@/lib/shared/thinking-level-utils";
import type { ModelMeta, ScheduledTask, TaskCreatePayload, TaskUpdatePayload } from "./types";
import type { TaskNotification } from "@/lib/shared/notifications";
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
import { CheckIcon, CloseIcon, LightbulbIcon, ToolIcon } from "@/components/ui/icons";
import { ToolsPickerModal, matchNamedToolPreset, TOOL_PRESET_LABELS, TOOL_PRESET_PATTERNS } from "@/components/chat/ToolsPickerModal";
import { listToolsForCwd } from "@/lib/client/agent-client";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import { expandToolPatterns } from "@/lib/shared/tool-selection";

// ── Form state ───────────────────────────────────────────────────

interface FormState {
  name: string;
  cron: string;
  cronValid: boolean;
  cwd: string;
  prompt: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  toolSelection: ToolSelection;
  /** Max lifetime in minutes. Empty / 0 ⇒ use the runner's default (2h). */
  maxLifetimeMinutes: string;
  // Notification
  notifyEnabled: boolean;
  notifySuccess: boolean;
  notifyError: boolean;
  notifyTimeout: boolean;
  channelType: string;
  channelId: string;
  recipientId: string;
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
  toolSelection: "all",
  maxLifetimeMinutes: "",
  notifyEnabled: false,
  notifySuccess: true,
  notifyError: true,
  notifyTimeout: true,
  channelType: "wechat",
  channelId: "",
  recipientId: "",
};

// Server-side bounds (kept in sync with lib/scheduler-store.ts).
const MIN_MAX_LIFETIME_MS = 1_000;
const MAX_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RUNNER_DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** Convert minutes-string from the form to ms. Returns null for empty /
 *  invalid input (the user wants the runner default). */
function parseMaxLifetimeMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round(n * 60_000);
  if (ms < MIN_MAX_LIFETIME_MS) return null;
  if (ms > MAX_MAX_LIFETIME_MS) return null;
  return ms;
}

/** Format ms max lifetime for the form (as minutes, or fallback). Used to
 *  pre-populate when editing an existing task. */
function formatMaxLifetimeForForm(ms: number | null): string {
  if (ms === null) return "";
  return String(Math.round(ms / 60_000));
}

// ── Thinking levels (mirror ChatInput) ──────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_COLOR: Record<(typeof THINKING_LEVELS)[number], string> = {
  off: "#94a3b8",
  minimal: "#38bdf8",
  low: "#3b82f6",
  medium: "#8b5cf6",
  high: "#f97316",
  xhigh: "#ef4444",
  max: "#b91c1c",
};

// ── Chat-input-style selector primitives ─────────────────────────
//
// The model / thinking / tools controls reuse the chat input bar's pill
// language: a borderless rounded trigger (hover/selected background only)
// with an AnimatedPopover panel using the same chrome (page background, 10px
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
  background: "var(--bg)",
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
  return { open, setOpen, rootRef };
}

/** Active checkmark / inactive spacer — ChatInput's row leading column. */
function CheckOrGap({ active }: { active: boolean }) {
  return active ? (
    <CheckIcon size={10} stroke="var(--accent)" style={{ flexShrink: 0 }} />
  ) : (
    <span style={{ width: 10, flexShrink: 0 }} />
  );
}

/** Lightbulb icon — same glyph as ChatInput's thinking trigger. */
function ThinkingIcon() {
  return (
    <LightbulbIcon size={11} style={{ flexShrink: 0 }} />
  );
}

/** Wrench icon — same glyph as ChatInput's tools trigger. */
function ToolsIcon() {
  return (
    <ToolIcon size={11} style={{ flexShrink: 0 }} />
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
  const [section, setSection] = useState<"basics" | "schedule" | "notifications">("basics");
  /** Known WeChat contact ids (xxx@im.wechat), loaded on open for the
   *  recipient picker. */
  const [contacts, setContacts] = useState<string[]>([]);
  const [wechatChannels, setWechatChannels] = useState<Array<{ id: string; name: string; userId: string | null; status: string }>>([]);
  /** Validation errors are suppressed until the user first clicks Save;
   *  flipping this on reveals field red-text and the per-section nav dots. */
  const [submitted, setSubmitted] = useState(false);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [customExpanded, setCustomExpanded] = useState(false);

  // Initial / reset form whenever the open state changes (a different
  // task, or a fresh create). Also refreshes the available WeChat contact
  // list so the recipient picker reflects current contacts.
  useEffect(() => {
    if (!open) return;
    // Best-effort: load known WeChat contacts for the recipient dropdown.
    apiFetch<{ channels?: Array<{ id: string; name: string; userId: string | null; status: string }> }>("/api/channels?provider=wechat")
      .then((res) => { setWechatChannels(res.channels ?? []); setContacts((res.channels ?? []).map((channel) => channel.userId).filter((id): id is string => Boolean(id))); })
      .catch(() => setWechatChannels([]));
    if (task) {
      const toolNames = task.toolNames ?? [];
      const n = task.notification;
      setForm({
        name: task.name,
        cron: task.cron,
        cronValid: (() => { try { new Cron(task.cron); return true; } catch { return false; } })(),
        cwd: task.cwd,
        prompt: task.prompt,
        provider: task.provider ?? "",
        modelId: task.modelId ?? "",
        // Old tasks that stored thinkingLevel="auto" or null have to be re-picked
        // on next edit — "auto" is no longer offered in the dropdown.
        thinkingLevel: task.thinkingLevel && task.thinkingLevel !== "auto" ? task.thinkingLevel : "",
        toolSelection: task.toolNames === null ? "all" : toolNames,
        maxLifetimeMinutes: formatMaxLifetimeForForm(task.maxLifetimeMs),
        notifyEnabled: !!n && n.channels.length > 0,
        notifySuccess: n?.onSuccess ?? true,
        notifyError: n?.onError ?? true,
        notifyTimeout: n?.onTimeout ?? true,
        channelType: n?.channels[0]?.type ?? "wechat",
        channelId: n?.channels[0]?.channelId ?? "",
        recipientId: n?.channels[0]?.recipientId ?? "",
      });
    } else {
      setForm({ ...EMPTY, cwd: initialCwd ?? "" });
    }
    setSection("basics");
    setSubmitted(false);
    setCustomExpanded(false);
  }, [open, task, initialCwd]);

  // Keep the scheduler's tool catalog in sync with the selected cwd, using
  // the same catalog endpoint as the chat tool picker.
  useEffect(() => {
    if (!open || !form.cwd.trim()) return;
    let cancelled = false;
    setToolsLoading(true);
    setToolsError(null);
    listToolsForCwd(form.cwd.trim())
      .then((tools) => { if (!cancelled) setAvailableTools(tools); })
      .catch((error) => { if (!cancelled) setToolsError(error instanceof Error ? error.message : "Failed to load tools"); })
      .finally(() => { if (!cancelled) setToolsLoading(false); });
    return () => { cancelled = true; };
  }, [open, form.cwd]);

  if (!isVisible) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const nameError = submitted && form.name.trim().length === 0 ? t("Please enter a task name") : null;
  const cwdError = submitted && form.cwd.trim().length === 0 ? t("Please enter a working directory") : null;
  const promptError = submitted && form.prompt.trim().length === 0 ? t("Please enter a prompt") : null;
  // Scheduled tasks must run with an explicit model + thinking level — falling
  // back to "default" silently would couple the task to whichever default is
  // active in settings.json at run time, so we force a concrete choice.
  const modelError = submitted && (!form.provider.trim() || !form.modelId.trim()) ? t("Please select a model") : null;
  const thinkingError = submitted && !form.thinkingLevel.trim() ? t("Please select a thinking level") : null;
  // Max lifetime is optional. If the user typed something, it must parse
  // to a positive integer within the server-side bounds; otherwise we
  // fall back to the runner default silently (so empty input is fine).
  const maxLifetimeRaw = form.maxLifetimeMinutes.trim();
  const maxLifetimeMs = parseMaxLifetimeMinutes(maxLifetimeRaw);
  const maxLifetimeError = submitted && maxLifetimeRaw && maxLifetimeMs === null
    ? t("Max lifetime must be between 1 and 1440 minutes")
    : null;
  // Cron builder has its own inline error (red border + syntax-error label) that
  // shows immediately while the user is editing — this is builder-internal
  // feedback, not form-level required-field validation, so it's intentional
  // that it surfaces before submit.
  const cronError = submitted && !form.cronValid ? t("Schedule syntax error") : null;
  const recipientId = form.recipientId.trim();
  const recipientError = (submitted && form.notifyEnabled && !recipientId)
    ? t("Please enter a WeChat recipient")
    : null;
  const channelError = (submitted && form.notifyEnabled && !form.channelId)
    ? t("Please select a WeChat channel")
    : null;
  const errors: Record<string, string | null> = {
    basics: nameError ?? promptError ?? cwdError ?? modelError ?? thinkingError,
    schedule: cronError ?? maxLifetimeError,
    notifications: channelError ?? recipientError,
  };

  const submit = async () => {
    if (saving) return;
    // First click reveals validation; subsequent edits keep the red text
    // visible until the next successful submit (which closes the modal).
    setSubmitted(true);
    const notifRecipientRequired = form.notifyEnabled && !recipientId;
    const hasError =
      !form.name.trim() ||
      !form.cwd.trim() ||
      !form.prompt.trim() ||
      !form.provider.trim() ||
      !form.modelId.trim() ||
      !form.thinkingLevel.trim() ||
      !form.cronValid ||
      (maxLifetimeRaw.length > 0 && maxLifetimeMs === null) ||
      notifRecipientRequired || (form.notifyEnabled && !form.channelId);
    if (hasError) {
      onToast("error", t("Please fix form errors first"));
      // Jump to the first section that has an error
      const firstError = (["basics", "schedule", "notifications"] as const).find((s) => {
        if (s === "basics")
          return (
            !form.name.trim() ||
            !form.prompt.trim() ||
            !form.cwd.trim() ||
            !form.provider.trim() ||
            !form.modelId.trim() ||
            !form.thinkingLevel.trim()
          );
        if (s === "schedule") return !form.cronValid;
        if (s === "notifications") return notifRecipientRequired || (form.notifyEnabled && !form.channelId);
        return false;
      });
      if (firstError) setSection(firstError);
      return;
    }
    setSaving(true);
    try {
      const toolNames: string[] | null = form.toolSelection === "all" ? null : form.toolSelection;

      // Build the notification payload: null (off) unless enabled + recipient.
      const notification: TaskNotification | null =
        form.notifyEnabled && recipientId
          ? {
              onSuccess: form.notifySuccess,
              onError: form.notifyError,
              onTimeout: form.notifyTimeout,
              channels: [{ type: form.channelType, channelId: form.channelId || undefined, recipientId }],
            }
          : null;

      const body: TaskCreatePayload | TaskUpdatePayload = {
        name: form.name.trim(),
        cron: form.cron.trim(),
        cwd: form.cwd.trim(),
        prompt: form.prompt.trim(),
        provider: form.provider.trim() || null,
        modelId: form.modelId.trim() || null,
        thinkingLevel: form.thinkingLevel.trim() || null,
        toolNames: toolNames,
        notification,
        // null = use runner default; otherwise send the parsed ms.
        maxLifetimeMs: form.maxLifetimeMinutes.trim() === "" ? null : maxLifetimeMs,
        // Cron is wall-clock based; persist the browser's IANA timezone so a
        // UTC-hosted server still runs the task at the time shown in the UI.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
            <CloseIcon width={16} height={16} />
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
              background: "var(--bg)",
            }}
          >
            {([
              { id: "basics", label: t("Basic config") },
              { id: "schedule", label: t("Scheduler") },
              { id: "notifications", label: t("Notifications") },
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
          <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            {section === "basics" && (
              <BasicConfigSection
                form={form}
                update={update}
                meta={meta}
                errors={{ name: nameError, prompt: promptError, cwd: cwdError, model: modelError, thinking: thinkingError }}
                availableTools={availableTools}
                toolsLoading={toolsLoading}
                toolsError={toolsError}
                customExpanded={customExpanded}
                onToggleCustomExpanded={() => setCustomExpanded((value) => !value)}
                onRetryTools={async () => {
                  if (!form.cwd.trim()) return;
                  setToolsLoading(true);
                  setToolsError(null);
                  try { setAvailableTools(await listToolsForCwd(form.cwd.trim())); }
                  catch (error) { setToolsError(error instanceof Error ? error.message : "Failed to load tools"); }
                  finally { setToolsLoading(false); }
                }}
              />
            )}
            {section === "schedule" && (
              <ScheduleSection form={form} update={update} cronError={cronError} maxLifetimeError={maxLifetimeError} />
            )}
            {section === "notifications" && (
              <NotificationsSection form={form} update={update} contacts={contacts} wechatChannels={wechatChannels} error={channelError ?? recipientError} />
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
            background: "var(--bg)",
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

function BasicConfigSection({ form, update, meta, errors, availableTools, toolsLoading, toolsError, customExpanded, onToggleCustomExpanded, onRetryTools }: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  meta: ModelMeta | null;
  errors: { name: string | null; prompt: string | null; cwd: string | null; model: string | null; thinking: string | null };
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  customExpanded: boolean;
  onToggleCustomExpanded: () => void;
  onRetryTools: () => Promise<void>;
}) {
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
        <ModelSelect form={form} update={update} meta={meta} error={errors.model} />
        <ThinkingSelect form={form} update={update} meta={meta} error={errors.thinking} />
        <ToolsSelect
          form={form}
          update={update}
          availableTools={availableTools}
          toolsLoading={toolsLoading}
          toolsError={toolsError}
          customExpanded={customExpanded}
          onToggleCustomExpanded={onToggleCustomExpanded}
          onRetry={onRetryTools}
        />
      </div>
    </div>
  );
}

function ScheduleSection({ form, update, cronError, maxLifetimeError }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void; cronError: string | null; maxLifetimeError: string | null }) {
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
      <Field
        label={t("Max lifetime")}
        hint={t("Max lifetime hint")}
        error={maxLifetimeError}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <NumberStepper
            value={form.maxLifetimeMinutes ? Number(form.maxLifetimeMinutes) : NaN}
            onChange={(minutes) => update("maxLifetimeMinutes", Number.isInteger(minutes) ? String(minutes) : "")}
            min={1}
            max={1440}
            ariaLabel={t("Max lifetime")}
            placeholder={String(Math.round(RUNNER_DEFAULT_MAX_LIFETIME_MS / 60_000))}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("minutes")}</span>
        </div>
      </Field>
    </div>
  );
}

function NotificationsSection({ form, update, contacts, wechatChannels, error }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void; contacts: string[]; wechatChannels: Array<{ id: string; name: string; userId: string | null; status: string }>; error: string | null }) {
  const { t } = useI18n();

  if (!form.notifyEnabled) {
    return (
      <div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={form.notifyEnabled}
            onChange={(e) => update("notifyEnabled", e.target.checked)}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("Send notifications when this task runs")}</span>
        </label>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
          {t("Notification hint")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={form.notifyEnabled}
          onChange={(e) => update("notifyEnabled", e.target.checked)}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("Send notifications when this task runs")}</span>
      </label>

      <Field label={t("Notify on outcome")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <OutcomeToggle label={t("On success")} checked={form.notifySuccess} onChange={(v) => update("notifySuccess", v)} />
          <OutcomeToggle label={t("On error")} checked={form.notifyError} onChange={(v) => update("notifyError", v)} />
          <OutcomeToggle label={t("On timeout")} checked={form.notifyTimeout} onChange={(v) => update("notifyTimeout", v)} />
        </div>
      </Field>

      <Field label={t("Channel")}>
        <select
          value={form.channelType}
          onChange={(e) => update("channelType", e.target.value)}
          style={{ ...inputStyle, maxWidth: 260 }}
        >
          <option value="wechat">{t("WeChat")}</option>
        </select>
      </Field>

      <Field label={t("WeChat channel")}>
        <select
          value={form.channelId}
          onChange={(e) => {
            const id = e.target.value;
            const selected = wechatChannels.find((channel) => channel.id === id);
            update("channelId", id);
            if (selected?.userId) update("recipientId", selected.userId);
          }}
          style={{ ...inputStyle, maxWidth: 360 }}
        >
          <option value="">{t("Select a channel")}</option>
          {wechatChannels.filter((channel) => channel.status === "connected").map((channel) => <option key={channel.id} value={channel.id}>{channel.name}{channel.userId ? ` (${channel.userId})` : ""}</option>)}
        </select>
      </Field>

      <Field
        label={t("Recipient")}
        hint={t("Recipient hint")}
        error={error}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={form.recipientId}
            onChange={(e) => update("recipientId", e.target.value)}
            placeholder="xxx@im.wechat"
            style={inputMonoStyle}
            list="wechat-recipient-options"
          />
          {contacts.length > 0 && (
            <datalist id="wechat-recipient-options">
              {contacts.map((id) => <option key={id} value={id} />)}
            </datalist>
          )}
          {contacts.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("Known contacts")}: {contacts.slice(0, 5).join(", ")}{contacts.length > 5 ? "…" : ""}
            </span>
          )}
        </div>
      </Field>
    </div>
  );
}

function OutcomeToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 12, color: "var(--text)" }}>{label}</span>
    </label>
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

function ModelSelect({ form, update, meta, error }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void; meta: ModelMeta | null; error?: string | null }) {
  const { t } = useI18n();
  const options = meta?.modelList ?? [];
  const modelIcons = meta?.modelIcons;
  const isUnselected = !form.provider || !form.modelId;
  const current = options.find((o) => o.provider === form.provider && o.id === form.modelId);
  // Stable identity across parent re-renders — TaskFormModal re-renders
  // often (toasts, meta loads, form tweaks), and a fresh object literal
  // here would churn ModelPickerModal's memoized deps every time.
  const pickerModel = useMemo(
    () => (isUnselected ? null : { provider: form.provider, modelId: form.modelId }),
    [isUnselected, form.provider, form.modelId],
  );
  // Plain local flag — the picker is a body-portal modal that owns its own
  // outside-click/Esc dismissal. A document-level mousedown handler (like
  // useDropdown's) would see clicks on the modal's rows/backdrop as
  // "outside the trigger" and close the modal mid-interaction, swallowing
  // the row click.
  const [open, setOpen] = useState(false);
  const triggerIconId = resolveProviderIcon(current?.provider, current?.id, modelIcons);

  return (
    <Field label={t("Model")} hint={t("Scheduler field required")} error={error}>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
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
            id={triggerIconId ?? ""}
            size={12}
            fallback={<ProviderGearIcon size={11} />}
          />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
            {isUnselected
              ? t("Select a model")
              : current?.name ?? `${form.provider}/${form.modelId}`}
          </span>
        </button>
        {/* Same `/model` picker modal as the chat input: grid layout +
            keyboard navigation, replacing the former vertical dropdown. */}
        <ModelPickerModal
          open={open}
          model={pickerModel}
          modelIcons={modelIcons}
          modelList={options}
          onModelChange={(provider, modelId) => {
            update("provider", provider);
            update("modelId", modelId);
            // Sync the thinking level to whatever the freshly selected
            // model actually supports. Scheduled tasks have to run with
            // an explicit level (no "auto"), so when the user picks a
            // new model and their previous level isn't supported we jump
            // to the closest valid one — otherwise the task would persist
            // a level that the run-time set_thinking_level call would
            // silently clamp, leaving the saved task out of sync with
            // what the agent actually uses. An empty string (user hasn't
            // picked yet) is left alone — the form's submit-time
            // validation owns that case.
            const nextKey = `${provider}:${modelId}`;
            const nextAvailable = meta?.thinkingLevels[nextKey] ?? null;
            const currentLevel = form.thinkingLevel;
            if (currentLevel && (THINKING_LEVEL_ORDER as readonly string[]).includes(currentLevel)) {
              const nextLevel = pickClosestAvailableThinkingLevel(
                currentLevel as (typeof THINKING_LEVEL_ORDER)[number],
                nextAvailable,
              );
              if (nextLevel !== currentLevel) {
                update("thinkingLevel", nextLevel);
              }
            }
          }}
          onClose={() => setOpen(false)}
        />
      </div>
    </Field>
  );
}

function ThinkingSelect({ form, update, meta, error }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void; meta: ModelMeta | null; error?: string | null }) {
  const { t } = useI18n();
  const key = form.provider && form.modelId ? `${form.provider}:${form.modelId}` : null;
  const available = key ? meta?.thinkingLevels[key] : undefined;
  const levelMap = key ? meta?.thinkingLevelMaps[key] : undefined;
  // Tasks must run with an explicit thinking level. The dropdown never offers
  // "auto" (now removed from the project entirely) and an empty form state
  // means "not chosen".
  const current = form.thinkingLevel
    ? (form.thinkingLevel as (typeof THINKING_LEVELS)[number])
    : null;
  const { open, setOpen, rootRef } = useDropdown();
  const currentMapped = current && levelMap ? levelMap[current] : undefined;
  const displayLabel = current
    ? (currentMapped != null && currentMapped !== current ? currentMapped : current)
    : t("Select a thinking level");

  return (
    <Field label={t("Thinking level")} hint={t("Scheduler field required")} error={error}>
      <div ref={rootRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            ...pillTriggerStyle(open),
            color: current ? THINKING_COLOR[current] : "var(--text-muted)",
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
            if (!available) return true;
            return available.includes(lvl);
          }).map((lvl) => {
            const active = current === lvl;
            const mappedVal = levelMap ? levelMap[lvl] : undefined;
            const label = mappedVal != null && mappedVal !== lvl ? mappedVal : lvl;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => {
                  update("thinkingLevel", lvl);
                  setOpen(false);
                }}
                style={dropdownOptionStyle(active)}
              >
                <CheckOrGap active={active} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: THINKING_COLOR[lvl], flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{label}</span>
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

function ToolsSelect({ form, update, availableTools, toolsLoading, toolsError, customExpanded, onToggleCustomExpanded, onRetry }: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  customExpanded: boolean;
  onToggleCustomExpanded: () => void;
  onRetry: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { open, setOpen, rootRef } = useDropdown();
  const selection = form.toolSelection;
  // Patterns (e.g. "codegraph_*") expand against the catalog for display; the
  // raw selection (patterns included) is what gets stored so the preset stays
  // recognisable and the server re-expands it when the task's session starts.
  const toolNames = availableTools.map((tool) => tool.name);
  const selectedCount = selection === "all" ? availableTools.length : expandToolPatterns(Array.isArray(selection) ? selection : [], toolNames).length;
  const namedPreset = matchNamedToolPreset(selection);
  const triggerLabel = selection === "all"
    ? t("All tools")
    : selection.length === 0
      ? t("No tools")
      : namedPreset
        ? t(TOOL_PRESET_LABELS[namedPreset])
        : t("Custom selection ({count}/{total})", { count: selectedCount, total: availableTools.length });

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
        <ToolsPickerModal
          open={open}
          toolSelection={selection}
          availableTools={availableTools}
          toolsLoading={toolsLoading}
          toolsError={toolsError}
          customExpanded={customExpanded}
          onSelectPreset={(preset) => {
            // Named presets are stored raw (patterns included); the server
            // expands them when the task's session starts, and unknown names
            // are ignored at apply time.
            const next: ToolSelection = preset === "off" ? []
              : preset === "full" ? "all"
              : [...TOOL_PRESET_PATTERNS[preset]];
            update("toolSelection", next);
            if (preset !== "read_only") setOpen(false);
          }}
          onToggleTool={(next) => update("toolSelection", next)}
          onToggleCustomExpanded={onToggleCustomExpanded}
          onRetryEnsureTools={onRetry}
          onClose={() => setOpen(false)}
        />
      </div>
    </Field>
  );
}