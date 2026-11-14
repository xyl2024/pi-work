"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PrimaryButton } from "../controls";
import { SettingsGroup, SettingsNote } from "../rows";
import { refreshSubagentProfiles } from "@/lib/client/subagent-profiles-store";
import type { SubagentProfile } from "@/lib/shared/subagent";
import { SubagentCard } from "../subagent-config/SubagentCard";
import { SubagentEditor } from "../subagent-config/SubagentEditor";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import { useSettingsPageData } from "../use-page-data";

async function loadSubagentProfiles(): Promise<SubagentProfile[]> {
  const response = await fetch("/api/subagents", { cache: "no-store" });
  const data = await response.json().catch(() => ({})) as { profiles?: SubagentProfile[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? "load failed");
  return data.profiles ?? [];
}

export function SubagentSection({ pageCache }: { pageCache: SettingsPageDataCache }) {
  const { t } = useI18n();
  const { data, loading, error, reload } = useSettingsPageData(
    pageCache,
    "subagent",
    loadSubagentProfiles,
  );
  const profiles = data ?? [];
  const [editing, setEditing] = useState<SubagentProfile | "new" | null>(null);

  const handleSaved = useCallback(async () => {
    setEditing(null);
    await reload();
    await refreshSubagentProfiles();
  }, [reload]);

  const handleDelete = useCallback(async (profile: SubagentProfile) => {
    if (!window.confirm(t("Delete subagent \"{name}\"?", { name: profile.name }))) return;
    const response = await fetch(`/api/subagents?name=${encodeURIComponent(profile.name)}`, { method: "DELETE" });
    if (response.ok) {
      await reload();
      await refreshSubagentProfiles();
    }
  }, [reload, t]);

  return (
    <>
      <SettingsNote>
        {t("Create the agents the subagent tool can launch. Each has its own prompt, tools, model, Pi Bot and timeout.")}
      </SettingsNote>

      <SettingsGroup
        action={<PrimaryButton onClick={() => setEditing("new")}>{t("New subagent")}</PrimaryButton>}
      >
        {loading ? (
          <SettingsNote>{t("Loading...")}</SettingsNote>
        ) : error ? (
          <SettingsNote tone="error">{error}</SettingsNote>
        ) : profiles.length === 0 ? (
          <SettingsNote>{t("No subagents configured yet.")}</SettingsNote>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, paddingTop: 8 }}>
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
      </SettingsGroup>

      {editing !== null && (
        <SubagentEditor
          profile={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
