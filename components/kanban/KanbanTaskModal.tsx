/**
 * KanbanTaskModal — create / edit a single Kanban task.
 *
 * Only the configuration that a board card needs: User prompt, model,
 * thinking level, working directory, and tool set. Defaults for a new task
 * come from the currently selected chat session (passed in as `defaults`),
 * matching the product decision that a new board card inherits the active
 * working context.
 *
 * Two field pickers are reused from the chat / scheduler surfaces so the
 * UI stays consistent: ModelPickerModal, ToolsPickerModal, CwdPicker.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "@/components/ui/icons";
import { ModelPickerModal } from "@/components/chat/ModelPickerModal";
import { CwdPicker } from "@/components/sessions/CwdPicker";
import { ToolsPickerModal, matchNamedToolPreset, TOOL_PRESET_LABELS, TOOL_PRESET_PATTERNS } from "@/components/chat/ToolsPickerModal";
import { listToolsForCwd } from "@/lib/client/agent-client";
import { CloseIcon, LightbulbIcon, ToolIcon } from "@/components/ui/icons";
import { pickClosestAvailableThinkingLevel, THINKING_LEVEL_ORDER } from "@/lib/shared/thinking-level-utils";
import { expandToolPatterns } from "@/lib/shared/tool-selection";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import type { KanbanTask } from "@/lib/shared/kanban-types";

interface ModelMeta {
  modelList: { id: string; name: string; provider: string }[];
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  modelIcons?: Record<string, string>;
  /** App-configured default model (from /api/models) — fallback when the
   *  current session has no model snapshot yet. */
  defaultModel: { provider: string; modelId: string } | null;
}

export interface KanbanTaskDefaults {
  cwd: string | null;
  model: { provider: string; modelId: string } | null;
  thinkingLevel: string;
  /** Active tools of the current session (default set for a new task). */
  toolNames: ToolInfo[];
}

interface Props {
  open: boolean;
  /** Task to edit, or null for create mode. */
  task: KanbanTask | null;
  defaults: KanbanTaskDefaults;
  onClose: () => void;
  /** Called after a successful save with the task id (create or edit). */
  onSaved: (taskId: string) => Promise<void> | void;
  onToast: (kind: "success" | "error", message: string) => void;
}

interface FormState {
  taskName: string;
  prompt: string;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  toolSelection: ToolSelection;
}

const THINKING_COLOR: Record<string, string> = {
  off: "#94a3b8",
  minimal: "#38bdf8",
  low: "#3b82f6",
  medium: "#8b5cf6",
  high: "#f97316",
  xhigh: "#ef4444",
  max: "#b91c1c",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 5,
};
const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 9,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};
const errorStyle: CSSProperties = { fontSize: 11, color: "var(--error)", marginTop: 4 };
const hintStyle: CSSProperties = { fontSize: 11, color: "var(--text-dim)", marginTop: 4 };

function pillTriggerStyle(open: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    height: 36,
    padding: "0 10px",
    boxSizing: "border-box",
    background: open ? "var(--bg-hover)" : "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
  };
}
function useDropdown() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  return { open, setOpen, rootRef };
}

function activeToolNames(tools: ToolInfo[]): string[] {
  return tools.filter((t) => t.active).map((t) => t.name);
}

export function KanbanTaskModal({ open, task, defaults, onClose, onSaved, onToast }: Props) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({
    isOpen: open,
    onClose,
  });

  const [form, setForm] = useState<FormState>({
    taskName: "",
    prompt: "",
    cwd: "",
    provider: "",
    modelId: "",
    thinkingLevel: "",
    toolSelection: "all",
  });
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [meta, setMeta] = useState<ModelMeta | null>(null);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [customExpanded, setCustomExpanded] = useState(false);
  // Model / tools pickers keep their own open flags (they portal to body).
  const [modelOpen, setModelOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // True once the user explicitly picked a model — the default-model fallback
  // effect must never overwrite an explicit choice made after open.
  const modelPickedRef = useRef(false);

  // Load model catalog once, when the modal first opens.
  useEffect(() => {
    if (!open || meta) return;
    fetch("/api/models", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setMeta({
          modelList: data.modelList ?? [],
          thinkingLevels: data.thinkingLevels ?? {},
          thinkingLevelMaps: data.thinkingLevelMaps ?? {},
          modelIcons: data.modelIcons ?? {},
          defaultModel: data.defaultModel ?? null,
        });
      })
      .catch(() => {
        /* models are optional */
      });
  }, [open, meta]);

  // Reset form + defaults only when the modal is (re)opened for a *new*
  // target (open=false -> open=true, or a different task). The parent panel
  // re-renders on every 5s poll, which would otherwise rebuild `defaults` as
  // a fresh object literal and clear the user's in-progress typing / close
  // their open pickers.
  const lastTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      lastTargetRef.current = null;
      return;
    }
    const key = task ? `edit:${task.id}` : "create";
    if (lastTargetRef.current === key) return;
    lastTargetRef.current = key;

    const activeTools =
      task !== null
        ? task.toolNames ?? "all"
        : defaults.toolNames.length > 0
          ? activeToolNames(defaults.toolNames)
          : "all";

    setForm({
      taskName: task?.taskName ?? "",
      prompt: task?.prompt ?? "",
      cwd: task?.cwd ?? defaults.cwd ?? "",
      provider: task?.provider ?? defaults.model?.provider ?? "",
      modelId: task?.modelId ?? defaults.model?.modelId ?? "",
      thinkingLevel:
        task?.thinkingLevel ?? defaults.thinkingLevel ?? "",
      toolSelection: activeTools,
    });
    setSubmitted(false);
    setCustomExpanded(false);
    setModelOpen(false);
    setToolsOpen(false);
    modelPickedRef.current = false;
  }, [open, task, defaults]);

  // When creating without an active-session model snapshot, prefill the
  // app-configured default model once the catalog loads — but never clobber a
  // model the user explicitly picked in this session.
  useEffect(() => {
    if (!open || task) return;
    if (modelPickedRef.current) return;
    const dm = meta?.defaultModel ?? null;
    if (!dm) return;
    setForm((prev) =>
      prev.provider || prev.modelId
        ? prev
        : { ...prev, provider: dm.provider, modelId: dm.modelId },
    );
  }, [open, task, meta]);

  // Keep the cwd tool catalog in sync with the selected cwd (same endpoint
  // the chat tool picker uses).
  useEffect(() => {
    if (!open || !form.cwd.trim()) return;
    let cancelled = false;
    setToolsLoading(true);
    setToolsError(null);
    listToolsForCwd(form.cwd.trim())
      .then((tools) => {
        if (!cancelled) setAvailableTools(tools);
      })
      .catch((error) => {
        if (!cancelled)
          setToolsError(error instanceof Error ? error.message : "Failed to load tools");
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, form.cwd]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const promptError = submitted && !form.prompt.trim() ? t("prompt is required") : null;
  const cwdError = submitted && !form.cwd.trim() ? t("cwd is required") : null;

  const submit = async () => {
    if (saving) return;
    setSubmitted(true);
    if (!form.prompt.trim() || !form.cwd.trim()) {
      onToast("error", t("Please fix form errors first"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        taskName: form.taskName.trim() || undefined,
        prompt: form.prompt.trim(),
        cwd: form.cwd.trim(),
        provider: form.provider.trim() || null,
        modelId: form.modelId.trim() || null,
        thinkingLevel: form.thinkingLevel || null,
        toolNames:
          form.toolSelection === "all" ? "all" : form.toolSelection,
      };

      let id: string;
      if (task) {
        const res = await fetch(`/api/kanban/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "update failed");
        }
        id = task.id;
        onToast("success", t("Saved"));
      } else {
        const res = await fetch("/api/kanban", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "create failed");
        }
        const data = (await res.json()) as { task: KanbanTask };
        id = data.task.id;
        onToast("success", t("Created task"));
      }
      await onSaved(id);
      requestClose();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : t("Failed to update task"));
    } finally {
      setSaving(false);
    }
  };

  const options = meta?.modelList ?? [];
  const modelIcons = meta?.modelIcons;
  const isUnselected = !form.provider || !form.modelId;
  const current = options.find((o) => o.provider === form.provider && o.id === form.modelId);
  const pickerModel = useMemo(
    () => (isUnselected ? null : { provider: form.provider, modelId: form.modelId }),
    [isUnselected, form.provider, form.modelId],
  );
  const triggerIconId = resolveProviderIcon(current?.provider, current?.id, modelIcons);

  const modelKey =
    form.provider && form.modelId ? `${form.provider}:${form.modelId}` : null;
  const availableLevels = modelKey ? meta?.thinkingLevels[modelKey] : undefined;
  const levelMap = modelKey ? meta?.thinkingLevelMaps[modelKey] : undefined;

  // Levels the current model actually supports — the cycle stays inside these
  // so the visible label never disagrees with what set_thinking_level lands on.
  const supportedLevels = (THINKING_LEVEL_ORDER as readonly string[]).filter(
    (lvl) => (availableLevels ? availableLevels.includes(lvl) : true),
  );
  const currentThinking = form.thinkingLevel || null;
  const thinkingDisplay =
    currentThinking != null && levelMap && levelMap[currentThinking] != null
      ? levelMap[currentThinking]!
      : currentThinking;
  // Click-to-cycle, matching the chat input's ThinkingPicker interaction.
  const cycleThinking = () => {
    if (supportedLevels.length === 0) return;
    const idx = supportedLevels.indexOf(currentThinking ?? "");
    const start = idx === -1 ? 0 : idx;
    const next = supportedLevels[(start + 1) % supportedLevels.length];
    if (next !== currentThinking) update("thinkingLevel", next);
  };

  const toolsDrp = useDropdown();

  const toolSelection = form.toolSelection;
  const toolNames = availableTools.map((tool) => tool.name);
  const selectedCount =
    toolSelection === "all"
      ? availableTools.length
      : expandToolPatterns(Array.isArray(toolSelection) ? toolSelection : [], toolNames).length;
  const namedPreset = matchNamedToolPreset(toolSelection);
  const toolsTriggerLabel =
    toolSelection === "all"
      ? t("All tools")
      : Array.isArray(toolSelection) && toolSelection.length === 0
        ? t("No tools")
        : namedPreset
          ? t(TOOL_PRESET_LABELS[namedPreset])
          : t("Custom selection ({count}/{total})", {
              count: selectedCount,
              total: availableTools.length,
            });

  if (!isVisible) return null;

  return (
    <div
      style={backdropStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        style={{
          ...panelStyle,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 520,
          maxWidth: "92vw",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
          maxHeight: "88vh",
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
            {task ? t("Edit") : t("New task")}
          </span>
          <button
            onClick={requestClose}
            aria-label={t("Close")}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "2px 6px",
              lineHeight: 1,
            }}
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        {/* Body */}
        <div
          data-scroll-wide
          style={{ flex: 1, overflowY: "auto", padding: "4px 18px 16px" }}
        >
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>{t("Task name")}</label>
            <input
              value={form.taskName}
              onChange={(e) => update("taskName", e.target.value)}
              placeholder={t("Task name hint")}
              style={{ ...inputStyle, padding: "8px 10px" }}
            />
            <div style={hintStyle}>{t("Leave empty to auto-derive from the prompt")}</div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>{t("User prompt")}</label>
            <textarea
              value={form.prompt}
              onChange={(e) => update("prompt", e.target.value)}
              rows={6}
              placeholder={t("Describe what the agent should do…")}
              autoFocus
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
            {promptError && <div style={errorStyle}>{promptError}</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 12px", marginBottom: 14, alignItems: "start" }}>
            {/* Left column: Model, Thinking level. Right column: Working directory, Tools. */}
            <div>
              <label style={labelStyle}>{t("Model")}</label>
              <button
                type="button"
                onClick={() => setModelOpen(true)}
                style={pillTriggerStyle(modelOpen)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = modelOpen ? "var(--bg-hover)" : "var(--bg)";
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
              <ModelPickerModal
                open={modelOpen}
                model={pickerModel}
                modelIcons={modelIcons}
                modelList={options}
                onModelChange={(provider, modelId) => {
                  modelPickedRef.current = true;
                  update("provider", provider);
                  update("modelId", modelId);
                  const nextKey = `${provider}:${modelId}`;
                  const nextAvailable = meta?.thinkingLevels[nextKey] ?? null;
                  const currentLevel = form.thinkingLevel;
                  if (
                    currentLevel &&
                    (THINKING_LEVEL_ORDER as readonly string[]).includes(currentLevel)
                  ) {
                    const nextLevel = pickClosestAvailableThinkingLevel(
                      currentLevel as (typeof THINKING_LEVEL_ORDER)[number],
                      nextAvailable,
                    );
                    if (nextLevel !== currentLevel) update("thinkingLevel", nextLevel);
                  }
                }}
                onClose={() => setModelOpen(false)}
              />
            </div>

            <div>
              <label style={labelStyle}>{t("Working directory")}</label>
              <CwdPicker cwd={form.cwd || null} onCwdChange={(c) => update("cwd", c)} fill />
              {cwdError && <div style={errorStyle}>{cwdError}</div>}
            </div>

            <div>
              <label style={labelStyle}>{t("Thinking level")}</label>
              {/* Click-to-cycle, mirroring the chat input's ThinkingPicker. */}
              <button
                type="button"
                onClick={cycleThinking}
                aria-label={t("Thinking level. Click to cycle.")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  height: 36,
                  padding: "0 10px",
                  boxSizing: "border-box",
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 9,
                  color:
                    currentThinking && THINKING_COLOR[currentThinking]
                      ? THINKING_COLOR[currentThinking]
                      : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                }}
              >
                <LightbulbIcon size={11} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
                  {thinkingDisplay ? thinkingDisplay : t("Select a thinking level")}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>↻</span>
              </button>
            </div>

            <div style={{ marginBottom: 0 }}>
              <label style={labelStyle}>{t("Tools")}</label>
              <div ref={toolsDrp.rootRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setToolsOpen((v) => !v)}
                style={pillTriggerStyle(toolsOpen)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = toolsOpen ? "var(--bg-hover)" : "var(--bg)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <ToolIcon size={11} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
                  {toolsTriggerLabel}
                </span>
              </button>
              <ToolsPickerModal
                open={toolsOpen}
                toolSelection={toolSelection}
                availableTools={availableTools}
                toolsLoading={toolsLoading}
                toolsError={toolsError}
                customExpanded={customExpanded}
                onSelectPreset={(preset) => {
                  const next: ToolSelection =
                    preset === "off"
                      ? []
                      : preset === "full"
                        ? "all"
                        : [...TOOL_PRESET_PATTERNS[preset]];
                  update("toolSelection", next);
                  if (preset !== "read_only") setToolsOpen(false);
                }}
                onToggleTool={(next) => update("toolSelection", next)}
                onToggleCustomExpanded={() => setCustomExpanded((v) => !v)}
                onRetryEnsureTools={async () => {
                  if (!form.cwd.trim()) return;
                  setToolsLoading(true);
                  setToolsError(null);
                  try {
                    setAvailableTools(await listToolsForCwd(form.cwd.trim()));
                  } catch (error) {
                    setToolsError(
                      error instanceof Error ? error.message : "Failed to load tools",
                    );
                  } finally {
                    setToolsLoading(false);
                  }
                }}
                onClose={() => setToolsOpen(false)}
              />
            </div>
            {toolsError && <div style={errorStyle}>{toolsError}</div>}
          </div>
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
            flexShrink: 0,
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            onClick={requestClose}
            disabled={saving}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("Cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "var(--on-accent, #fff)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? t("Saving…") : task ? t("Save") : t("Create task")}
          </button>
        </div>
      </div>
    </div>
  );
}