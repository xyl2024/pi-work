"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { CwdPicker } from "@/components/sessions/CwdPicker";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { CronBuilder } from "@/components/scheduler/CronBuilder";
import { listToolsForCwd } from "@/lib/client/agent-client";
import { fetchWechatChannels, type SchedulerChannel } from "@/lib/client/scheduler-io";
import { saveSchedulerForm, schedulerBack, updateSchedulerForm, useSchedulerStore } from "@/lib/client/scheduler-store";
import {
  Field,
  SchedulerModelSelect,
  SchedulerThinkingSelect,
  SchedulerToolsSelect,
} from "./SchedulerFormFields";
import { SchedulerBackButton } from "./SchedulerBackButton";
import { btnGhost, btnPrimary, inputMonoStyle, inputStyle, textareaStyle } from "@/components/scheduler/styles";
import {
  listTimezones,
  parseMaxLifetimeMinutes,
  RUNNER_DEFAULT_MAX_LIFETIME_MS,
} from "@/lib/shared/scheduler-form";
import type { SchedulerTaskForm } from "@/lib/shared/scheduler";
import type { ToolInfo } from "@/lib/shared/types";

export function SchedulerFormPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { form, formTaskId, meta, saving, saveError } = useSchedulerStore();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [channels, setChannels] = useState<SchedulerChannel[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [customExpanded, setCustomExpanded] = useState(false);

  useEffect(() => {
    void fetchWechatChannels().then(setChannels).catch(() => setChannels([]));
  }, []);

  const formCwd = form?.cwd ?? "";
  const timezones = useMemo(() => {
    const zones = listTimezones();
    const current = form?.timezone;
    return current && !zones.includes(current) ? [current, ...zones] : zones;
  }, [form?.timezone]);

  useEffect(() => {
    if (!formCwd.trim()) return;
    let cancelled = false;
    setToolsLoading(true);
    setToolsError(null);
    listToolsForCwd(formCwd.trim())
      .then((tools) => {
        if (!cancelled) setAvailableTools(tools);
      })
      .catch((error) => {
        if (!cancelled) setToolsError(error instanceof Error ? error.message : "Failed to load tools");
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formCwd]);

  if (form === null) return null;

  const update = (partial: Partial<SchedulerTaskForm>) => updateSchedulerForm(partial);

  const nameError = submitted && form.name.trim().length === 0 ? t("Please enter a task name") : null;
  const cwdError = submitted && form.cwd.trim().length === 0 ? t("Please enter a working directory") : null;
  const promptError = submitted && form.prompt.trim().length === 0 ? t("Please enter a prompt") : null;
  const modelError = submitted && (!form.provider.trim() || !form.modelId.trim()) ? t("Please select a model") : null;
  const thinkingError = submitted && !form.thinkingLevel.trim() ? t("Please select a thinking level") : null;
  const maxLifetimeRaw = form.maxLifetimeMinutes.trim();
  const maxLifetimeMs = parseMaxLifetimeMinutes(maxLifetimeRaw);
  const maxLifetimeError =
    submitted && maxLifetimeRaw && maxLifetimeMs === null ? t("Max lifetime must be between 1 and 1440 minutes") : null;
  const cronError = submitted && !form.cronValid ? t("Schedule syntax error") : null;
  const recipientId = form.recipientId.trim();
  const channelError = submitted && form.notifyEnabled && !form.channelId ? t("Please select a WeChat channel") : null;
  const recipientError = submitted && form.notifyEnabled && !recipientId ? t("Please enter a WeChat recipient") : null;

  const submit = async () => {
    if (saving) return;
    setSubmitted(true);
    const hasError =
      !form.name.trim() ||
      !form.cwd.trim() ||
      !form.prompt.trim() ||
      !form.provider.trim() ||
      !form.modelId.trim() ||
      !form.thinkingLevel.trim() ||
      !form.cronValid ||
      (maxLifetimeRaw.length > 0 && maxLifetimeMs === null) ||
      (form.notifyEnabled && (!recipientId || !form.channelId));
    if (hasError) {
      toast.show({ kind: "error", message: t("Please fix form errors first") });
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector("[data-field-error='true']") as HTMLElement | null;
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return;
    }
    const result = await saveSchedulerForm();
    if (result.ok) {
      toast.show({ kind: "success", message: formTaskId ? t("Task updated") : t("Task created") });
    } else if (result.error) {
      toast.show({ kind: "error", message: result.error });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexShrink: 0 }}>
        <SchedulerBackButton />
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          {formTaskId ? t("Edit task") : t("New task")}
        </span>
      </div>

      <div
        ref={scrollRef}
        data-scroll-wide
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 14px 16px" }}
      >
        <Section title={t("Basic config")}>
          <Field label={t("Task name")} hint={t("Concise description, e.g. daily report")} error={nameError}>
            <input
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder={t("e.g. daily report")}
              autoFocus
              className="scheduler-text-input"
              style={inputStyle}
            />
          </Field>
          <Field label={t("Prompt")} hint={t("Full prompt sent to agent at trigger time")} error={promptError}>
            <textarea
              value={form.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
              rows={8}
              placeholder={t("Check yesterday's PRs for unhandled comments and summarize...")}
              className="scheduler-text-input"
              style={textareaStyle}
            />
          </Field>
          <Field label={t("Working directory")} hint={t("The cwd the agent runs in; must exist")} error={cwdError}>
            <CwdPicker cwd={form.cwd || null} onCwdChange={(value) => update({ cwd: value })} fill />
          </Field>
          <SchedulerModelSelect form={form} update={update} meta={meta} error={modelError} />
          <SchedulerThinkingSelect form={form} update={update} meta={meta} error={thinkingError} />
          <SchedulerToolsSelect
            form={form}
            update={update}
            availableTools={availableTools}
            toolsLoading={toolsLoading}
            toolsError={toolsError}
            customExpanded={customExpanded}
            onToggleCustomExpanded={() => setCustomExpanded((value) => !value)}
            onRetry={async () => {
              if (!form.cwd.trim()) return;
              setToolsLoading(true);
              setToolsError(null);
              try {
                setAvailableTools(await listToolsForCwd(form.cwd.trim()));
              } catch (error) {
                setToolsError(error instanceof Error ? error.message : "Failed to load tools");
              } finally {
                setToolsLoading(false);
              }
            }}
          />
        </Section>

        <Section title={t("Scheduler")}>
          <Field label={t("Cron expression")} hint={t("Cron examples hint")} error={cronError}>
            <CronBuilder
              value={form.cron}
              onChange={(cron, valid) => update({ cron, cronValid: valid })}
            />
          </Field>
          <Field label={t("Max lifetime")} hint={t("Max lifetime hint")} error={maxLifetimeError}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <NumberStepper
                value={form.maxLifetimeMinutes ? Number(form.maxLifetimeMinutes) : NaN}
                onChange={(minutes) => update({ maxLifetimeMinutes: Number.isInteger(minutes) ? String(minutes) : "" })}
                min={1}
                max={1440}
                ariaLabel={t("Max lifetime")}
                placeholder={String(Math.round(RUNNER_DEFAULT_MAX_LIFETIME_MS / 60_000))}
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("minutes")}</span>
            </div>
          </Field>
          <Field label={t("Timezone")} hint={t("Timezone hint")}>
            <select value={form.timezone} onChange={(e) => update({ timezone: e.target.value })} style={inputStyle}>
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title={t("Notifications")}>
          <NotificationsSection
            form={form}
            update={update}
            channels={channels}
            channelError={channelError}
            recipientError={recipientError}
          />
        </Section>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        {saveError && (
          <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--error)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {saveError}
          </span>
        )}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button type="button" onClick={schedulerBack} disabled={saving} style={btnGhost}>
            {t("Cancel")}
          </button>
          <button type="button" onClick={() => void submit()} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
            {saving ? t("Saving...") : formTaskId ? t("Save changes") : t("Create & enable")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function NotificationsSection({
  form,
  update,
  channels,
  channelError,
  recipientError,
}: {
  form: SchedulerTaskForm;
  update: (partial: Partial<SchedulerTaskForm>) => void;
  channels: SchedulerChannel[];
  channelError: string | null;
  recipientError: string | null;
}) {
  const { t } = useI18n();
  const contacts = channels.map((channel) => channel.userId).filter((id): id is string => Boolean(id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={form.notifyEnabled}
          onChange={(e) => update({ notifyEnabled: e.target.checked })}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {t("Send notifications when this task runs")}
        </span>
      </label>

      {form.notifyEnabled && (
        <>
          <Field label={t("Notify on outcome")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <OutcomeToggle label={t("On success")} checked={form.notifySuccess} onChange={(v) => update({ notifySuccess: v })} />
              <OutcomeToggle label={t("On error")} checked={form.notifyError} onChange={(v) => update({ notifyError: v })} />
              <OutcomeToggle label={t("On timeout")} checked={form.notifyTimeout} onChange={(v) => update({ notifyTimeout: v })} />
            </div>
          </Field>

          <Field label={t("Channel")}>
            <select value={form.channelType} onChange={(e) => update({ channelType: e.target.value })} style={inputStyle}>
              <option value="wechat">{t("WeChat")}</option>
            </select>
          </Field>

          <Field label={t("WeChat channel")} error={channelError}>
            <select
              value={form.channelId}
              onChange={(e) => {
                const id = e.target.value;
                const selected = channels.find((channel) => channel.id === id);
                update({ channelId: id, ...(selected?.userId ? { recipientId: selected.userId } : {}) });
              }}
              style={inputStyle}
            >
              <option value="">{t("Select a channel")}</option>
              {channels
                .filter((channel) => channel.status === "connected")
                .map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                    {channel.userId ? ` (${channel.userId})` : ""}
                  </option>
                ))}
            </select>
          </Field>

          <Field label={t("Recipient")} hint={t("Recipient hint")} error={recipientError}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                value={form.recipientId}
                onChange={(e) => update({ recipientId: e.target.value })}
                placeholder="xxx@im.wechat"
                style={inputMonoStyle}
                list="wechat-recipient-options"
              />
              {contacts.length > 0 && (
                <datalist id="wechat-recipient-options">
                  {contacts.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              )}
              {contacts.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {t("Known contacts")}: {contacts.slice(0, 5).join(", ")}
                  {contacts.length > 5 ? "…" : ""}
                </span>
              )}
            </div>
          </Field>
        </>
      )}
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
