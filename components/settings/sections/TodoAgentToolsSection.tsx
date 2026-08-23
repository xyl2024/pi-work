"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TOOL_KEYS } from "@/components/todos/user-todo/utils";

/**
 * Section: Pi agent tools (todo).
 *
 * Toggles which todo tools are exposed to the pi agent. The persisted
 * source of truth is `lib/server/user-todo/tools-config.ts`
 * (`~/.pi-work/todo-tools.json`), surfaced through `/api/todo-tools`.
 * Each checkbox click is immediate-apply — no Save button. The change
 * only takes effect on sessions started after the PUT; running sessions
 * keep their original tool set (matching the contract enforced by
 * `createAgentSession` in `lib/server/rpc-manager.ts`).
 *
 * The list of tool keys is mirrored here from `TOOL_KEYS` in
 * `components/todos/user-todo/utils.ts`. Keep the two in sync — they
 * both describe the same registry.
 */
export function TodoAgentToolsSection() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/todo-tools")
      .then((r) => r.json())
      .then((data: { enabled?: string[] }) => {
        if (cancelled) return;
        const list = Array.isArray(data.enabled) ? data.enabled : [...TOOL_KEYS];
        setEnabled(new Set(list));
      })
      .catch(() => {
        if (cancelled) return;
        setEnabled(new Set(TOOL_KEYS));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Immediate-apply: each toggle optimistically updates local state,
  // then PUTs the full enabled list. The server re-orders/normalizes
  // the input before persisting, so we re-sync from the response body
  // to stay canonical. On failure we revert to the pre-toggle snapshot.
  const handleToggle = useCallback(async (name: string) => {
    if (enabled === null) return;
    const previous = enabled;
    const next = new Set(previous);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setEnabled(next);
    setPending(name);
    try {
      const res = await fetch("/api/todo-tools", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: Array.from(next) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { enabled: string[] };
      setEnabled(new Set(data.enabled));
    } catch {
      setEnabled(previous);
    } finally {
      setPending(null);
    }
  }, [enabled]);

  return (
    <div data-settings-section="settings-section-todo-agent-tools" style={{ marginBottom: 24, marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("Todo agent tools")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
        {t("Choose which todo tools the pi agent can use. Changes apply to new sessions only — running sessions keep their current tool set.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TOOL_KEYS.map((name) => {
          const checked = enabled?.has(name) ?? false;
          const disabled = enabled === null || (pending !== null && pending !== name);
          return (
            <label
              key={name}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: 13,
                color: disabled ? "var(--text-dim)" : "var(--text)",
                opacity: disabled ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => void handleToggle(name)}
                style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: disabled ? "not-allowed" : "pointer" }}
              />
              <span>{t(`Tool: ${name}`)}</span>
            </label>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "10px 0 0 0", lineHeight: 1.5 }}>
        {t("Applies to new sessions")}
      </p>
    </div>
  );
}
