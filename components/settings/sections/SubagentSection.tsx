"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PrimaryButton } from "../controls";
import { SettingsSection } from "../SettingsSection";
import { refreshSubagentProfiles } from "@/lib/client/subagent-profiles-store";
import type { SubagentProfile } from "@/lib/shared/subagent";
import { SubagentCard } from "../subagent-config/SubagentCard";
import { SubagentEditor } from "../subagent-config/SubagentEditor";

/**
 * Subagents settings section — the CRUD list for the profiles `spawn_subagent`
 * can launch. Edits commit immediately through `/api/subagents` (like an avatar
 * upload), so this section does not participate in the settings modal's staged
 * save; it keeps its own list and reloads after a write.
 */
export function SubagentSection() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SubagentProfile | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/subagents", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { profiles?: SubagentProfile[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "load failed");
      setProfiles(data.profiles ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSaved = useCallback(async () => {
    setEditing(null);
    await load();
    await refreshSubagentProfiles();
  }, [load]);

  const handleDelete = useCallback(async (profile: SubagentProfile) => {
    if (!window.confirm(t("Delete subagent \"{name}\"?", { name: profile.name }))) return;
    const response = await fetch(`/api/subagents?name=${encodeURIComponent(profile.name)}`, { method: "DELETE" });
    if (response.ok) {
      await load();
      await refreshSubagentProfiles();
    }
  }, [load, t]);

  return (
    <SettingsSection id="subagent" topGap>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>{t("Subagent settings")}</h3>
        <PrimaryButton onClick={() => setEditing("new")}>{t("New subagent")}</PrimaryButton>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>
        {t("Create the agents the spawn_subagent tool can launch. Each has its own prompt, tools, model, Pi Bot and timeout.")}
      </p>

      {loading ? (
        <div style={{ padding: "20px 0", color: "var(--text-dim)", fontSize: 12 }}>{t("Loading...")}</div>
      ) : error ? (
        <div style={{ padding: "20px 0", color: "var(--error)", fontSize: 12 }}>{error}</div>
      ) : profiles.length === 0 ? (
        <div style={{ padding: "20px 0", color: "var(--text-dim)", fontSize: 12 }}>{t("No subagents configured yet.")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
          {profiles.map((profile) => (
            <SubagentCard
              key={profile.name}
              profile={profile}
              onEdit={() => setEditing(profile)}
              onDelete={() => void handleDelete(profile)}
            />
          ))}
        </div>
      )}

      {editing !== null && (
        <SubagentEditor
          profile={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </SettingsSection>
  );
}
