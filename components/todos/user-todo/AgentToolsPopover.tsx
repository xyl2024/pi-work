"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { TOOL_KEYS } from "./utils";

export function AgentToolsPopover({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const ref = useRef<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set(TOOL_KEYS));
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/todo-tools")
      .then((r) => r.json())
      .then((data: { enabled?: string[] }) => {
        if (cancelled) return;
        const list = Array.isArray(data.enabled) ? data.enabled : [...TOOL_KEYS];
        setEnabled(new Set(list));
        setDraft(new Set(list));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setEnabled(new Set(TOOL_KEYS));
        setDraft(new Set(TOOL_KEYS));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const toggle = (name: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const dirty = enabled !== null && (() => {
    if (draft.size !== enabled.size) return true;
    for (const k of draft) if (!enabled.has(k)) return true;
    return false;
  })();

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/todo-tools", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: [...draft] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { enabled: string[] };
      setEnabled(new Set(data.enabled));
      setDraft(new Set(data.enabled));
      toast.show({ kind: "success", message: t("Saved") });
      onClose();
    } catch {
      toast.show({ kind: "error", message: t("Save failed") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("Pi agent tools")}
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        zIndex: 10,
        minWidth: 200,
        padding: 6,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {t("Pi agent tools")}
      </div>
      <div role="group" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {TOOL_KEYS.map((name) => {
          const checked = draft.has(name);
          return (
            <label
              key={name}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 8px",
                fontSize: 11,
                background: checked ? "var(--bg-selected)" : "transparent",
                borderRadius: 4,
                cursor: "pointer",
                color: checked ? "var(--text)" : "var(--text-muted)",
                fontFamily: "inherit",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(name)}
                disabled={!loaded || saving}
                style={{ margin: 0, cursor: "pointer" }}
              />
              {t(`Tool: ${name}`)}
            </label>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 0" }}>
        {t("Applies to new sessions")}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, display: "flex", justifyContent: "flex-end", gap: 4 }}>
        <button
          onClick={onClose}
          style={{
            padding: "2px 8px",
            fontSize: 11,
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t("Close")}
        </button>
        <button
          onClick={onSave}
          disabled={!loaded || !dirty || saving}
          style={{
            padding: "2px 10px",
            fontSize: 11,
            background: !loaded || !dirty || saving ? "var(--bg)" : "var(--accent)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: !loaded || !dirty || saving ? "var(--text-dim)" : "var(--bg)",
            cursor: !loaded || !dirty || saving ? "not-allowed" : "pointer",
            fontWeight: 500,
            fontFamily: "inherit",
          }}
        >
          {t("Save")}
        </button>
      </div>
    </div>
  );
}