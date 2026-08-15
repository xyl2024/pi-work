"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmDialog";

interface PromptTemplate {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  filePath: string;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
}

function shortenPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(prompt: PromptTemplate): string {
  const src = prompt.sourceInfo?.source;
  const scope = prompt.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

function PromptDetail({
  prompt,
  cwd,
  editable,
  onEdit,
  onDelete,
}: {
  prompt: PromptTemplate;
  cwd: string;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(prompt);

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: 3,
            flexShrink: 0,
            background: label === "project" ? "rgba(99,102,241,0.12)" : "rgba(120,120,120,0.12)",
            color: label === "project" ? "rgba(99,102,241,0.8)" : "var(--text-dim)",
          }}
        >
          {t(label)}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayPath(prompt.filePath)}
        </span>
        {editable && (
          <>
            <button
              onClick={onEdit}
              title={t("Edit Prompt")}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px 7px",
                fontSize: 11,
                lineHeight: 1.4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              {t("Edit")}
            </button>
            <button
              onClick={onDelete}
              title={t("Delete prompt")}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px 7px",
                fontSize: 11,
                lineHeight: 1.4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(248,113,113,0.12)";
                e.currentTarget.style.color = "#f87171";
                e.currentTarget.style.borderColor = "#f87171";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              {t("Delete")}
            </button>
          </>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{t("Name")}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text)" }}>
          /{prompt.name}{prompt.argumentHint ? ` ${prompt.argumentHint}` : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{t("Description")}</span>
        <span style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {prompt.description || t("No description")}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7, minHeight: 0 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{t("Content")}</span>
        <pre
          style={{
            height: 340,
            overflow: "auto",
            margin: 0,
            padding: 12,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {prompt.content}
        </pre>
      </div>
    </div>
  );
}

function PromptEditorPanel({
  cwd,
  mode,
  initial,
  onSaved,
}: {
  cwd: string;
  mode: "create" | "edit";
  initial?: PromptTemplate;
  onSaved: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [scope, setScope] = useState<"global" | "project">("global");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [argumentHint, setArgumentHint] = useState(initial?.argumentHint ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = useCallback(async () => {
    if (!name.trim() || !content.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const url = mode === "create" ? "/api/prompts" : "/api/prompts";
      const method = mode === "create" ? "POST" : "PUT";
      const payload: Record<string, unknown> = { cwd, name, description, argumentHint, content };
      if (mode === "create") payload.scope = scope;
      if (mode === "edit") payload.filePath = initial?.filePath;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = (await res.json()) as { success?: boolean; filePath?: string; error?: string };
      if (!res.ok || d.error || !d.filePath) {
        const msg = d.error ?? `HTTP ${res.status}`;
        setError(msg);
        toast.show({
          kind: "error",
          message: mode === "create" ? msg : t("Failed to edit prompt") + `: ${msg}`,
        });
        return;
      }
      onSaved(d.filePath);
      toast.show({
        kind: "success",
        message: mode === "create" ? t("Prompt created") : t("Prompt updated"),
      });
    } catch (e) {
      const msg = String(e);
      setError(msg);
      toast.show({ kind: "error", message: msg });
    } finally {
      setSaving(false);
    }
  }, [argumentHint, content, cwd, description, initial?.filePath, mode, name, onSaved, saving, scope, t, toast]);

  const isEditing = mode === "edit";
  const nameLocked = isEditing;
  const targetPath = isEditing
    ? shortenPath(initial?.filePath ?? "")
    : scope === "global"
      ? "~/.pi/agent/prompts/"
      : `${shortenPath(cwd)}/.pi/prompts/`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
        {isEditing ? t("Edit Prompt") : t("New Prompt")}
      </div>

      {!isEditing && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              borderRadius: 5,
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  borderRight: s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {t(s)}
              </button>
            ))}
          </div>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            -&gt; {targetPath}
          </span>
        </div>
      )}
      {isEditing && (
        <span
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {targetPath}
        </span>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{t("Name")}</span>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="review"
          readOnly={nameLocked}
          style={{
            padding: "7px 10px",
            fontSize: 13,
            background: nameLocked ? "var(--bg-subtle)" : "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: nameLocked ? "var(--text-dim)" : "var(--text)",
            outline: "none",
            fontFamily: "var(--font-mono)",
            cursor: nameLocked ? "not-allowed" : "text",
          }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{t("Description")}</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("Optional")}
          style={{
            padding: "7px 10px",
            fontSize: 13,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            outline: "none",
          }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{t("Argument hint")}</span>
        <input
          value={argumentHint}
          onChange={(e) => setArgumentHint(e.target.value)}
          placeholder="<file> [instructions]"
          style={{
            padding: "7px 10px",
            fontSize: 13,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            outline: "none",
            fontFamily: "var(--font-mono)",
          }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{t("Content")}</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Review $1 and focus on $ARGUMENTS"
          style={{
            height: 240,
            resize: "none",
            padding: "9px 10px",
            fontSize: 13,
            lineHeight: 1.5,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            outline: "none",
            fontFamily: "var(--font-mono)",
          }}
        />
      </label>

      {error && <div style={{ fontSize: 12, color: "#f87171", wordBreak: "break-word" }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={save}
          disabled={saving || !name.trim() || !content.trim()}
          style={{
            padding: "7px 16px",
            fontSize: 13,
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            cursor: saving || !name.trim() || !content.trim() ? "not-allowed" : "pointer",
            opacity: saving || !name.trim() || !content.trim() ? 0.5 : 1,
          }}
        >
          {saving
            ? isEditing
              ? t("Editing...")
              : t("Creating...")
            : isEditing
              ? t("Save")
              : t("Create")}
        </button>
      </div>
    </div>
  );
}

export function PromptsConfig({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { requestClose, backdropStyle, panelStyle } = useModalAnimation({
    isOpen: true,
    onClose,
  });
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  type Mode = "view" | "create" | "edit";
  const [mode, setMode] = useState<Mode>("view");
  const [editing, setEditing] = useState<PromptTemplate | null>(null);

  function isEditable(prompt: PromptTemplate): boolean {
    const scope = prompt.sourceInfo?.scope;
    return scope === "user" || scope === "project";
  }

  const loadPrompts = useCallback((preferredSelected?: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/prompts?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((d: { prompts?: PromptTemplate[]; error?: string }) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        const list = d.prompts ?? [];
        setPrompts(list);
        setSelected((cur) => {
          if (preferredSelected && list.some((p) => p.filePath === preferredSelected)) return preferredSelected;
          if (cur && list.some((p) => p.filePath === cur)) return cur;
          return list[0]?.filePath ?? null;
        });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cwd]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const selectedPrompt = prompts.find((p) => p.filePath === selected) ?? null;

  const startEdit = useCallback((prompt: PromptTemplate) => {
    setEditing(prompt);
    setMode("edit");
  }, []);

  const exitEditor = useCallback(() => {
    setMode("view");
    setEditing(null);
  }, []);

  const deletePrompt = useCallback(async (prompt: PromptTemplate) => {
    const ok = await confirm({
      title: t("Delete prompt?"),
      description: t("This will delete the prompt file: {path}").replace("{path}", prompt.filePath),
      confirmLabel: t("Delete"),
      cancelLabel: t("Cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch("/api/prompts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, filePath: prompt.filePath }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        const msg = d.error ?? `HTTP ${res.status}`;
        toast.show({ kind: "error", message: t("Failed to delete prompt") + `: ${msg}` });
        return;
      }
      toast.show({ kind: "success", message: t("Prompt deleted") });
      // If the deleted one is currently selected, clear the selection.
      setSelected((cur) => (cur === prompt.filePath ? null : cur));
      loadPrompts();
    } catch (e) {
      toast.show({ kind: "error", message: String(e) });
    }
  }, [confirm, cwd, loadPrompts, t, toast]);

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
          width: 860,
          height: "78vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("Prompts")}</span>
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
          </div>
          <button
            onClick={requestClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div
            style={{
              width: 210,
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("Loading...")}</div>
              ) : error ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "#f87171" }}>{error}</div>
              ) : prompts.length === 0 ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)" }}>{t("No prompts found")}</div>
              ) : (
                (() => {
                  const groups: { label: string; prompts: typeof prompts }[] = [];
                  for (const grpLabel of ["project", "global", "path"]) {
                    const grpPrompts = prompts.filter((p) => sourceLabel(p) === grpLabel);
                    if (grpPrompts.length > 0) groups.push({ label: grpLabel, prompts: grpPrompts });
                  }
                  return groups.map(({ label: grpLabel, prompts: grpPrompts }) => (
                    <div key={grpLabel} style={{ marginBottom: 6 }}>
                      <div
                        style={{
                          padding: "4px 8px 3px",
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--text-dim)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {t(grpLabel)}
                      </div>
                      {grpPrompts.map((prompt) => {
                        const isSelected = mode === "view" && selected === prompt.filePath;
                        return (
                          <div
                            key={prompt.filePath}
                            onClick={() => {
                              setSelected(prompt.filePath);
                              exitEditor();
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "8px 8px",
                              borderRadius: 5,
                              cursor: "pointer",
                              background: isSelected ? "var(--bg-selected)" : "none",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) e.currentTarget.style.background = "none";
                            }}
                          >
                            <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                              /
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: isSelected ? 600 : 400,
                                color: "var(--text)",
                                fontFamily: "var(--font-mono)",
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {prompt.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ));
                })()
              )}
            </div>

            <div style={{ padding: "8px 6px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              <div
                onClick={() => {
                  setMode("create");
                  setEditing(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 8px",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: mode === "create" ? "var(--bg-selected)" : "none",
                  color: mode === "create" ? "var(--accent)" : "var(--text-dim)",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (mode === "view") e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (mode === "view") e.currentTarget.style.background = "none";
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t("New Prompt")}
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {mode !== "view" ? (
              <PromptEditorPanel
                key={mode === "edit" ? `edit:${editing?.filePath ?? ""}` : "create"}
                cwd={cwd}
                mode={mode === "create" ? "create" : "edit"}
                initial={mode === "edit" ? editing ?? undefined : undefined}
                onSaved={(filePath) => {
                  exitEditor();
                  loadPrompts(filePath);
                }}
              />
            ) : loading ? null : selectedPrompt ? (
              <PromptDetail
                key={selectedPrompt.filePath}
                prompt={selectedPrompt}
                cwd={cwd}
                editable={isEditable(selectedPrompt)}
                onEdit={() => startEdit(selectedPrompt)}
                onDelete={() => deletePrompt(selectedPrompt)}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                {t("Select a prompt")}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={requestClose}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
